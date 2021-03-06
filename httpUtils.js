const http = require('http');
const https = require('https');
const urllib = require('url');
const qs = require('querystring');
const fs = require('fs');

let jsonLenMax = 1024*100;
let bodyLenMax = 1024*500;

function inferMime(fname) {
	if(fname.endsWith('manifest.json'))
		return 'application/manifest+json';

	switch(fname.substr(fname.lastIndexOf('.')+1).toLowerCase()) {
	case 'js':
		return 'application/javascript';
	case 'json':
		return 'application/json';
	case 'html':
		return 'text/html';
	case 'txt':
		return 'text/plain';
	case 'css':
		return 'text/css';
	case 'png':
		return 'image/png';
	case 'jpg':
		return 'image/jpg';
	case 'gif':
		return 'image/gif';
	case 'ico':
		return 'image/x-icon';
	case 'svg':
		return 'image/svg+xml';
	case 'woff':
		return 'font/woff';
	case 'woff2':
		return 'font/woff2';
	case 'mp3':
		return 'audio/mpeg';
	case 'appcache':
		return 'text/cache-manifest';
	default:
		console.warn('mime-type unknown for ',fname);
		return 'text/plain';
	}
}

function respond(resp, code, body, mime) {
	if(Array.isArray(code)) {
		body = code[1];
		code = code[0];
	}
	let headers = { 'Cache-Control': 'no-cache, no-store, must-revalidate, proxy-revalidate', 'Pragma':'no-cache',
		'Access-Control-Allow-Origin':'*' };
	headers['Content-Type'] = mime ? mime : (typeof body == 'object') ? 'application/json' : 'text/plain';
	//console.log('>>', code, body);
	if(code==204) {
		resp.writeHead(code, headers);
		resp.end();
	}
	else if(code==200) {
		resp.writeHead(code, headers);
		resp.end((typeof body == 'object') ? JSON.stringify(body)
			: (typeof body == 'number') ? body.toString() : body);
	}
	else setTimeout(()=>{ // thwart brute force attacks
		console.log('>>', code, body);
		headers['Content-Type']='application/json';
		resp.writeHead(code, headers);
		resp.end('{"status":'+code+',"error":'+JSON.stringify(body)+'}');
	}, 1500); // delay potential denial of service / brute force attacks
	return true;
}

function serveStatic(resp, path, basePath) {
	if(path.indexOf('..')>=0)
		return respond(resp, 403, 'Forbidden');
	if(!basePath)
		basePath = __dirname;
	fs.readFile(basePath + '/'+path, (err,data)=>{
		if (err)
			return respond(resp, 404, err.message);

		let mime = inferMime(path);
		let headers = { 'Content-Type':mime };
		if(mime.startsWith('image/'))
			headers['Cache-Control'] = 'public, max-age=31536000'; // 1year
		resp.writeHead(200, headers);
		resp.end(data);
	});
	return true;
}

function streamMedia(resp, path, basePath) {
	if(path.indexOf('..')>=0)
		return respond(resp,403, 'Forbidden');
	if(!basePath)
		basePath = __dirname;
	fs.open(basePath + '/'+path, 'r', (err, fd)=>{
		if(err)
			return respond(resp, 404, err);

		let mime = inferMime(path);
		resp.setHeader('Content-Type', mime);
		resp.setHeader('Transfer-Encoding', 'chunked');

		let fstream = fs.createReadStream('',{fd:fd});
		fstream.pipe(resp);
	});
	return true;
}

function parseUrl(url, params) {
	if(typeof(url)=='string')
		url = urllib.parse(url, true);
	if(!Array.isArray(url.path)) {
		url.path = url.pathname.substr(1).split('/');
		if(url.path.length && url.path[url.path.length-1]=='')
			url.path.pop();
	}
	if(params)
		url.query = params;
	for(let key in url.query) {
		let value = url.query[key];
		if(typeof value == 'string' && (value[0]=='{' || value[0]=='[' || value[0]=='"' ) && value.length<=jsonLenMax) try {
			url.query[key] = JSON.parse(value);
		}
		catch(err) {
			console.error('url query JSON.parse ERROR', err);
		}
	}
	return url;
}

function redirect(req, resp, url, dest) {
	if(!dest)
		return false;
	let code = 302;
	if(typeof dest=='object') {
		let prot = dest.protocol ? dest.protocol : url.protocol ? url.protocol :
			req.connection.encrypted ? 'https:' : 'http:';
		if(prot.slice(-1)!=':')
			prot += ':';
		let hostname = dest.hostname ? dest.hostname :
			url.hostname ? url.hostname : req.headers.host;
		let port = dest.port ? dest.port : (url.port!=80 && url.port!=443) ? url.port : '';
		let pathname = dest.pathname ? dest.pathname : dest.path ?
			('/' + dest.path.join('/')) : url.pathname;
		let search = dest.search ? dest.search :
			dest.query ? ('?'+qs.stringify(dest.query)) : url.search;
		let u = '';
		if(hostname || prot || port)
			u = prot + '//' + hostname;
		if(port)
			u += ':' + port;
		u += pathname;
		if(search)
			u += search; 
		if(url.hash)
			u += url.hash;
		if('code' in dest)
			code = dest.code;
		dest = u;
	}
	console.log(req.method, req.url,'--', code, '-->', dest);
	resp.writeHead(code, { 'Location': dest });
	resp.end();
	return true;
}

// transparent reverse proxy delegation to dest server, based on https://stackoverflow.com/a/20354642
function delegate(client_req, client_resp, dest) {
	const getIp = function(ip) {
		return (ip.substr(0, 7) == "::ffff:") ? ip.substr(7) : ip;
	}
	//console.log('serve: ' + client_req.url);

	if(typeof dest === 'string')
		dest = new URL(dest);
	let options = {
		hostname: dest.hostname,
		protocol: dest.protocol ? dest.protocol : 'http:',
		port: dest.port,
		path: client_req.url,
		method: client_req.method,
		headers: {}
	};
	options.headers.host = options.hostname+':'+options.port;
	for(let key in client_req.headers)
		if(key!='host')
			options.headers[key] = client_req.headers[key];

	if(!('x-forwarded-for' in options.headers))
		options.headers['x-forwarded-for'] = getIp(client_req.socket.remoteAddress);
	options.headers['x-forwarded-for'] 	+= ', '+ getIp(client_req.socket.localAddress);
	//console.log(options);

	let proxy_resp = null;
	const httpx = (options.protocol == 'https:') ? https : http;
	let proxy_req = httpx.request(options, (resp)=>{
		proxy_resp = resp;
		if(resp.statusCode>=300 && resp.statusCode<400) { // handle redirect:
			let redirect = new URL(resp.headers.location);
			if(redirect.protocol == options.protocol && redirect.hostname == options.hostname
				&& redirect.port == options.port)
			{
				redirect.protocol = ('getTicketKeys' in client_req.client.server) ? 'https:' : 'http:';
				redirect.host = client_req.headers.host;
				resp.headers.location = redirect.href;
			}
			//console.log('redirect location:', redirect);
		}
		client_resp.writeHead(resp.statusCode, resp.headers);
		resp.pipe(client_resp, { end: true });
	});

	proxy_req.on('error', (err)=>{
		if(err.code == 'ECONNRESET') // client-side hang up
			client_resp.end();
		else {
			console.error(err);
			respond(client_resp, 500, err);
		}
	});
	client_resp.on('close', ()=>{
		if(proxy_resp) {
			proxy_resp.unpipe();
			proxy_resp = null;
		}
		proxy_req.abort();
	});
	client_req.pipe(proxy_req, { end: true });
	return true;
}

function createServer(cfg, handlers) {
	if(typeof handlers === 'function')
		handlers = [ handlers ];

	let handler = function(req, resp) {
		// parse request:
		let params = {};
		let handle = function() {
			let url = parseUrl(req.url, req.method=='POST' ? params : null);
			if('x-forwarded-proto' in req.headers)
				url.protocol = req.headers['x-forwarded-proto'] + ':';
			if('x-forwarded-host' in req.headers)
				url.hostname = req.headers['x-forwarded-host'];
			if('x-forwarded-port' in req.headers)
				url.port = req.headers['x-forwarded-port'];

			for(let i=0, end=handlers.length; i!=end; ++i)
				if(handlers[i](req, resp, url))
					return;
			respond(resp, 404, req.url+" Not Found");
		}
		if(cfg.retainRequestBody || req.method!='POST')
			return handle();
		let body = '';
		req.on('data', (data)=>{
			body += data;
			if (body.length > bodyLenMax) { // avoid flood attack
				resp.writeHead(413, {'Content-Type': 'text/plain'}).end();
				req.connection.destroy();
			}
		});
		req.on('end', ()=>{
			params = qs.parse(body);
			handle();
		});
	}

	let ip = cfg.ip || '0.0.0.0';
	let port = cfg.port || (cfg.sslPath ? 443 : 80);
	if('jsonLenMax' in cfg)
		jsonLenMax = cfg.jsonLenMax;
	if('bodyLenMax' in cfg)
		bodyLenMax = cfg.bodyLenMax;

	let server = cfg.sslPath
		? https.createServer({
			key: fs.readFileSync(cfg.sslPath + 'privkey.pem'),
			cert: fs.readFileSync(cfg.sslPath + 'fullchain.pem') }, handler)
		: http.createServer(handler);
	server.listen(port, ip);
	console.log(cfg.sslPath ? 'https':'http','server listening at', ip+':'+port);
	server.isHttps = cfg.sslPath ? true : false;
	return server;
}

function parseArgs(args, settings) {
	if(!args.length)
		return true;

	for(let i=0; i+1<args.length; i+=2) {
		if(args[i].substr(0,2)!='--') {
			console.error('ERROR arguments expected  as --arg1 value1 --argn value_n...');
			return false;
		}
		let key = args[i].substr(2), value=args[i+1];
		if(!(key in settings))
			console.warn('WARNING ignoring unrecognized argument key', key);
		else
			settings[key]=value;
	}
	return true;
}

function post(url, params, callback) {
	const data = params ? 'params='+JSON.stringify(params) : '';
	const options = {
	  method: 'POST',
	  headers: {
		'Content-Type': 'application/json',
		'Content-Length': data.length
	  }
	}

	const protocol = url.startsWith('http:') ? http: https;
	const req = protocol.request(url, options, callback ? (resp)=>{
		if(resp.statusCode>=400)
			return callback(resp.statusCode);
		let body = '';
		resp.on('data', (chunk) => { body += chunk; });
		resp.on('end', ()=>{
			try {
				body = JSON.parse(body);
			} catch (er) { }
			callback(null, body);
		});
	} : null);
	if(callback)
		req.on('error', (error)=>{ callback(error); });
	req.write(data);
	req.end();
}

function onShutdown(callback) {
	const shutdown = function() {
		if(callback)
			callback();
		setTimeout(()=>{ process.exit(); }, 250);
	}
	process.on('SIGINT', shutdown);
	process.on('SIGTERM', shutdown);
}

module.exports = {
	respond: respond,
	serveStatic: serveStatic,
	streamMedia: streamMedia,
	createServer: createServer,
	redirect: redirect,
	delegate: delegate,
	parseArgs: parseArgs,
	parseUrl: parseUrl,
	post: post,
	onShutdown: onShutdown
}
