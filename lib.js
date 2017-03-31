require('harmony-reflect');

var DDPServer = function(opts) {

  var auxFunctions = {
    login: ({
      password: pass = undefined, resume: token = undefined,
      user: { username: user = undefined, email = undefined, } = {}
    }) => {
      if (token) return { handleResume: { token } }
      return { handleLogin: { user, pass, email } }
    },
    error: (e, data, ws) => {
      console.log("error calling method", data.method, e)
      sendMessage({
        id: data.id,
        error: {
          error: 500,
          reason: "Internal Server Error",
          errorType: "Meteor.Error"
        }
      }, ws)
    },
    missing: (data, ws) => {
      console.log("Error method " + data.method + " not found");
      sendMessage({
        id: data.id,
        error: {
          error: 404,
          reason: "Method not found",
          errorType: "Meteor.Error"
        }
      }, ws)
    },
    sendMessage: (data, ws) => {
      ws.send(EJSON.stringify(data));
    },
  };

  opts = opts || {};
  var WebSocket = require('faye-websocket'),
      EJSON = require('ejson'),
      http = require('http'),
      server = opts.httpServer,
      methods = opts.methods || {},
      collections = {},
      subscriptions = {},
      self = this;

  if (!server) {
    server = http.createServer()
    server.listen(opts.port || 3000);
  }

  server.on('upgrade', function (request, socket, body) {
    if (WebSocket.isWebSocket(request)) {
      var ws = new WebSocket(request, socket, body);
      var session_id = "" + new Date().getTime();
      subscriptions[session_id] = {};


      ws.on('message', function(event) {
        var data = JSON.parse(event.data);

        switch (data.msg) {

        case "connect":

          auxFunctions['sendMessage']({
            msg: "connected",
            session: session_id
          }, ws)

          break;

        case "method":

          if (data.method in methods) {

            try {
              var result = methods[data.method].apply(this, data.params)

              auxFunctions['sendMessage']({
                msg: "result",
                id: data.id,
                result: result
              }, ws);

              auxFunctions['sendMessage']({
                msg: "updated",
                id: data.id
              }, ws)

            } catch (e) { auxFunctions['error'](e, data, ws) }

          } else if (data.method === 'login') {

            try {
              var iResult = auxFunctions[data.method].apply(this, data.params)

              var result = 'Error'

              if (iResult['handleResume']) {
                result = methods['handleResume'].apply(
                  this, [iResult['handleResume']]
                )
              } else if (iResult['handleLogin']) {
                result = methods['handleLogin'].apply(
                  this, [iResult['handleLogin']]
                )
              }

              auxFunctions['sendMessage']({
                msg: "result",
                id: data.id,
                result: result
              }, ws)

              auxFunctions['sendMessage']({
                msg: "updated",
                id: data.id
              }, ws)

            } catch (e) { auxFunctions['error'](e, data, ws) }

          } else { auxFunctions['missing'](data, ws) }

          break;

        case "sub":

          subscriptions[session_id][data.name] = {
            added: function(id, doc) {
              auxFunctions['sendMessage']({
                msg: "added",
                collection: data.name,
                id: id,
                fields: doc
              })
            },
            changed: function(id, fields, cleared) {
              auxFunctions['sendMessage']({
                msg: "changed",
                collection: data.name,
                id: id,
                fields: fields,
                cleared: cleared
              })
            },
            removed: function(id) {
              auxFunctions['sendMessage']({
                msg: "removed",
                collection: data.name,
                id: id
              })
            }
          };

          var docs = collections[data.name];
          for (var id in docs)
            subscriptions[session_id][data.name].added(id, docs[id]);

          auxFunctions['sendMessage']({
            msg: "ready",
            subs: [data.id]
          });

          break;

        case "ping":

          auxFunctions['sendMessage']({
            msg: "pong",
            id: data.id
          });

          break;

        default:
        }
      });

      ws.on('close', function(event) {
        delete subscriptions[session_id];
        ws = null;
        session_id = null;
      });
    }
  });

  this.methods = function(newMethods) {
    for (var key in newMethods) {
      if (key in methods)
        throw new Error(500, "A method named " + key + " already exists");
      methods[key] = newMethods[key];
    }
  }

  this.publish = function(name) {
    if (name in collections)
      throw new Error(500, "A collection named " + name + " already exists");

    var documents = {};
    var proxiedDocuments = {};

    function add(id, doc) {
      documents[id] = doc;
      proxiedDocuments[id] = new Proxy(doc, {
        set: function(_, field, value) {
          var changed = {};
          doc[field] = changed[field] = value;
          sendChanged(id, changed, []);
          return value;
        },
        deleteProperty: function(_, field) {
          delete doc[field];
          sendChanged(id, {}, [field]);
          return true;
        }
      });
      for (var client in subscriptions)
        if (subscriptions[client][name])
          subscriptions[client][name].added(id, doc);
    }

    function change(id, doc) {
      var cleared = [];
      for (var field in documents[id]) {
        if (!(field in doc)) {
          cleared.push(field)
          delete documents[id][field];
        }
      }
      var changed = {};
      for (var field in doc)
        if (doc[field] != documents[id][field])
          documents[id][field] = changed[field] = doc[field];
      sendChanged(id, changed, cleared);
    }
    function sendChanged(id, changed, cleared) {
      for (var client in subscriptions)
        if (subscriptions[client][name])
          subscriptions[client][name].changed(id, changed, cleared);      
    }

    function remove(id) {
      delete documents[id];
      for (var client in subscriptions)
        if (subscriptions[client][name])
          subscriptions[client][name].removed(id);
    }

    return collections[name] = new Proxy(documents, {
      get: function(_, id) {
        return proxiedDocuments[id];
      },
      set: function(_, id, doc) {
        if (documents[id])
          change(id, doc);
        else
          add(id, doc);
        return proxiedDocuments[id];
      },
      deleteProperty: function(_, id) {
        remove(id);
        return true;
      }
    });
  }
}

module.exports = DDPServer
