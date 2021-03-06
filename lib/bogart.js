var
  path         = require('path'),
  Q            = require('promised-io/lib/promise'),
  util         = require('./util'),
  Router       = require('./router').Router,
  middleware   = require('./middleware'),
  when         = Q.when;

exports.version = [0,2,0];

exports.middleware = middleware;

/**
 * A request to a bogart router
 */
function Request() {}

/**
 * Creates a request object given a router and a jsgi request.
 * This function is primarily intended to be used internally by bogart; however, it could be
 * used by a third party library to compose bogart routers with its own handling mechanisms.
 *
 * @type Request
 */
exports.request = function(router, jsgiReq) {
  var
    search        = util.extractSearch(jsgiReq),
    requestedWith = jsgiReq.headers['x-requested-with'],
    isxhr         = !util.no(requestedWith), parsedBody,
    contentType   = jsgiReq.headers['content-type'],
    req           = Object.create(new Request(), {
      router: { value: router, enumerable: true, readonly: true },
      search: { value: search, enumerable: true, readonly: true },
      isXMLHttpRequest: { value: isxhr, enumerable: true, readonly: true }
    });

  for (var k in jsgiReq) {
    Object.defineProperty(req, k, { value: jsgiReq[k], readonly: true, enumerable: true });
  }
  
  return req;
};

/**
 * Creates a @see ViewEngine
 *
 * Example:
 *     bogart.viewEngine("mustache", require("path").join(__dirname, "/templates"))
 *
 * @param {String} engineName  the name of the engine, available: ["mustache", "haml"]
 * @param {String} viewsPath   Path where the views are located.  Defaults to /views
 * @member bogart
 */
exports.viewEngine = function(engineName, viewsPath) {
  return require("./view").viewEngine(engineName, viewsPath || exports.maindir()+"/views");
};

/**
 * Deprecated, use bogart#router instead
 * @ignore
 */
exports.app = function(config, notFoundApp) {
  console.log("app is deprecated, please use bogart.router");
  
  return exports.router(config, notFoundApp);
};

/**
 * Creates a bogart router.  A router is responsible for routing requests to appropriate handlers.
 *
 * Example:
 *     bogart.router(function(get, post, put, del) {
 *       get('/', function() { return bogart.html('Hello World'); });
 *     });
 *
 * @param {Function} config       DSL configuration of routes.
 * @param {Function} notFoundApp  JSGI application to execute when no route from config matches the request.
 */
exports.router = function(config, notFoundApp) {
  var
    defaultNotFoundApp = function(req) {
      var body = 'Not Found';
      if (req.pathInfo) {
        body += ': ' + req.pathInfo;
      }
      
      return {
        status: 404,
        body: [body],
        headers: { 'Content-Length': body.length, 'Content-Type': 'text/html' }
      };
    },
    router = new Router(config),
    fn;
  
  fn = function(req) {
    var resp;
    try {
      respPromise = router.respond(exports.request(this, req));
      if(util.no(respPromise) && req.pathInfo !== "/routes") {
        if (notFoundApp) { 
          return notFoundApp(req); 
        }
        else { 
          return defaultNotFoundApp(req);
        }
      }
      if (util.no(respPromise) && req.pathInfo === '/routes') {
        var str = 'GET<br />';

        router.routes['get'].forEach(function(r) {
          str += '<p>';
          str += 'path: ' + r.path + '<br />' + 'paramNames: ' + r.paramNames;
          str += '</p>';
        });

        return { status: 200, headers: { 'Content-Length': str.length, "Content-Type":"text/html" }, body: [ str ] };
      }

      return when(respPromise, function(resp) {
        if (util.no(resp.status)) {
          throw new Error('Response must have "status" property');
        }
        if (util.no(resp.body)) {
          throw new Error('Response must have "body" property');
        }
        if (typeof resp.body.forEach !== 'function') {
          throw new Error('Response "body" property must have a forEach method');
        }

        return resp;
      });
    } catch (err) {
      var str = 'Error';
      if (err && err.toString) {
        str += '<br />'+err.toString();
      }
      if (err && err.stack) {
        str += '<br />'+JSON.stringify(err.stack);
      }
      return exports.html(str, { status: 500 });
    }
  };

  ['get','post','put','del'].forEach(function(x) {
    fn[x] = router[x].bind(router);
  });

  return fn;
};

/**
 * Deprecated, use bogart#build instead
 * @ignore
 */
exports.server = function(config) {
  console.log("'bogart.server' is deprecated, please switch to 'bogart.build'");
  return exports.build(config);
}

/**
 * Utility class to help in creating stacks of JSGI applications.
 * Allows the removal of nesting.
 *  
 * @param {Function} config   A configuration function that will be called by exports.build.  The function will be
 *                            be provided via its 'this' reference two functions: use, clear
 *
 * @returns {Function} A JSGI application that can be started using @see bogart#start
 */
exports.build = function(config) {
  var
    self = this,
    app;
  
  this.middleware = [];
  
  this.use = function() {
    this.middleware.push(Array.prototype.slice.call(arguments));
  };

  this.clear = function() {
    this.middleware = [];
  };
  
  this.use(middleware.ParseForm);
  this.use(middleware.ParseJson);
  
  config.call(this);
  
  this.middleware = this.middleware.reverse();
  
  this.middleware.forEach(function(middle) {
    var callable = middle.shift();

    middle.push(app);
    app = callable.apply(self, middle);
  });

  return function(req) {
    return app(req);
  };
};

/**
 * Starts a server
 *
 * @param {Function} jsgiApp   JSGI application to run
 * @param {Object} options     Options hash.  Supports 'port' property which allows specification of port for server.
 *                             Port defaults to 8080.  More options are planned for the future.
 */
exports.start = function(jsgiApp, options) {
  require("jsgi").start(jsgiApp, options);
};

/**
 * Text response.  Bogart helper method to create a JSGI response.
 * Returns a default JSGI response with body containing the specified text, a status of 200,
 * and headers.  The headers included are "content-type" of "text" and "content-length" set
 * appropriately based upon the length of 'txt' parameter.
 *
 * @param {String} txt  Text for the body of the response.
 */
exports.text = function(txt) {
  return {
    status: 200,
    body: [txt],
    headers: { "content-type": "text", "content-length": txt.length }
  };
};

/**
 * HTML response.  Bogart helper method to create a JSGI response.
 * Returns a default JSGI response with body containing the specified html, a status of 200,
 * and headers.  The headers included are "content-type" of "text/html" and "content-length" set
 * appropriately based upon the length of the 'html' parameter.
 *
 * @param {String} html  HTML for the body of the response
 * @param {Object} opts  Options to override JSGI response defaults.  For example, passing { status: 404 } would
 *                       cause the resulting JSGI response's status to be 404.
 *
 * @returns JSGI Response
 * @type Object
 */ 
exports.html = function(html, opts) {
  opts = opts || {};
  html = html || "";
  
  return {
    status: opts.status || 200,
    body: [html],
    headers: { "content-type": "text/html", "content-length": html.length }
  };
};

/**
 * Bogart helper function to create a JSGI response.
 * Returns a default JSGI response with body containing the specified object represented as JSON, a status of 200,
 * and headers.  The headers included are "content-type" of "application/json" and "content-length" set 
 * appropriately based upon the length of the JSON representation of @paramref(obj)
 *
 *     var resp = bogart.json({ a: 1});
 *     sys.inspect(resp)  
 * 
 * Assuming node-style sys.inspect, evalutes to:
 * { 
 *   status: 200,
 *   headers: { "content-type": "application/json", "content-length": 5 },
 *   body: [ "{a:1}" ]
 * }
 *                               
 *
 * @param {Object} obj  Object to be represented as JSON
 * @param {Object} opts Options to override JSGI response defaults.  For example, passing {status: 404 } would 
 *                      cause the resulting JSGI response's status to be 404.
 */
exports.json = function(obj, opts) {
  opts = opts || {};
  
  var str = JSON.stringify(obj);
  
  return {
    status: opts.status || 200,
    body: [str],
    headers: { "content-type": "application/json", "content-length": str.length }
  };
};

exports.error = function(msg, opts) {
  opts = opts || {};
  msg = msg || "Server Error";
  
  return {
    status: opts.status || 500,
    body: [msg],
    headers: { "content-type": "text/html", "content-length": msg.length }
  };
};

/**
 * Bogart helper function to create a JSGI response.
 * Returns a default JSGI response the redirects to the url provided by the 'url' parameter.
 *
 *     var resp = bogart.redirect("http://google.com");
 *     sys.inspect(resp)  
 * 
 * Assuming node-style sys.inspect, evalutes to:
 * { 
 *   status: 302,
 *   headers: { "location": "http://google.com" },
 *   body: []
 * }
 *                               
 *
 * @param {String} url  URL to which the JSGI response will redirect
 * @returns JSGI response for a 302 redirect
 * @type Object
 */
exports.redirect = function(url) {
  return {
    status: 302,
    headers: { "location": url },
    body: []
  };
};

/**
 * Bogart helper function to create a JSGI response.
 * Returns a default JSGI response the redirects to the url provided by the 'url' parameter.
 *
 *     var resp = bogart.permanentRedirect("http://google.com");
 *     sys.inspect(resp)  
 * 
 * Assuming node-style sys.inspect, evalutes to:
 * { 
 *   status: 301,
 *   headers: { "location": "http://google.com" },
 *   body: []
 * }
 *                               
 *
 * @param {String} url  URL to which the JSGI response will redirect
 * @returns JSGI response for a permanent (301) redirect
 * @type Object
 */
exports.permanentRedirect = function(url){
    return {
        status:301,
        headers: {"location": url},
        body: []
    };
};

/**
 * Bogart helper function to create a JSGI response.
 * Returns a default JSGI response with a status of 304 (not modified).
 *
 *     var resp = bogart.notModified();
 *     sys.inspect(resp)  
 * 
 * Assuming node-style sys.inspect, evalutes to:
 * { 
 *   status: 304,
 *   body: []
 * }
 *                               
 * @returns JSGI response for a not modified response (304).
 * @type Object
 */
exports.notModified = function(){
  return {
      status: 304,
      body:[]
  };  
};

exports.stream = function() {
  var 
    deferred = Q.defer(),
    buffer = [],
    streamer = function(progress) {
      deferred.progress(progress);
    };
  
  streamer.end = function() {
    deferred.resolve();
  };
    
  streamer.respond = function(opts) {
    opts = opts || {};
    opts.status = opts.status || 200;
    opts.headers = opts.headers || { "Content-Type": "text/plain" };
    
    return {
      status: opts.status,
      body: { 
        forEach: function(cb) {
          when(deferred, function success() {
          }, function error() {
            
          }, function(update) { 
            cb(update);
          });
          
          return deferred;
        }
      },
      headers: opts.headers
    };
  };
    
  return streamer;
};

/**
 * Helper function to determine the main directory of the application.  Currently only supports nodules.
 * TODO: Support this in vanilla node.js as well.
 */
exports.maindir = function() {
  return path.dirname(require.main.id).replace("file://","");
};


