require('harmony-reflect')

const WebSocket = require('faye-websocket')
const EJSON     = require('ejson')
const http      = require('http')

class WebSocketHandler {

  constructor ({request, socket, body}) {
    this.ws = new WebSocket(request, socket, body)
    this.sessionId     = "" + new Date().getTime()
    this.collections   = {}
    this.subscriptions = {}
    this.methods       = {}
    ws.on('message', handleMessage)
    ws.on('close',   handleClose)
  }

  getSessionId () {
    return this.sessionId
  }

  handleClose (event) {
    delete this.subscriptions[this.sessionId]
    this.ws = null
    this.sessionId = null
  }

  handleMessage (event) {
    let data = JSON.parse(event.data)

    switch (data.msg) {
    case "connect":

      auxFunctions['sendMessage']({
        msg: "connected",
        session: sessionId
      }, ws)

      break;

    case "method":

      if (data.method in methods) {

        try {
          let result = methods[data.method].apply(this, data.params)

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

      } else if (data.method === 'login') {

        try {
          let iResult = auxFunctions[data.method].apply(this, data.params)

          let result = 'Error'

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
      }

      let docs = this.collections[data.name]

      for (let id in docs) {
        this.subscriptions[this.sessionId][data.name].added(id, docs[id])
      }

      auxFunctions['sendMessage']({
        msg: "ready",
        subs: [data.id]
      })

      break;

    case "ping":

      auxFunctions['sendMessage']({
        msg: "pong",
        id: data.id
      })

      break;

    default:
    }
  }

}

class DDPServer {
  constructor (opts = {}) {
    this.server        = opts.httpServer
    this.methods       = opts.methods || {}
    this.sockets       = []
    !server && this.createServer()
    this.addWebsocketListener()
  }

  createServer () {
    this.server = http.createServer()
    this.server.listen(opts.port || 3000)
  }

  addWebsocketListener () {
    this.server.on('upgrade', (req, socket, body) => {
      // Make sure the request is a web socket
      if ( WebSocket.isWebSocket(req) ) {
        // Create a handler to manage the socket connection events
        let wsHandle = new WebSocketHandler({req, socket, body}, this.methods)
        // Keep track of connected sockets (users)
        this.sockets.push(wsHandle)
        // Keep track of subscriptions (connected users pub/sub)
        this.subscriptions[wsHandle.getSessionId()] = {}
      }
    }
  }
}


