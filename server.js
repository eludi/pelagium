const os = require('os');

const httpUtils = require('./httpUtils');
const Sim = require('./static/sim');
const Storage = require('./DiskStorage');
const JsonValidator = require('./JsonSchemaValidator')

let cfg = {
	ip:'0.0.0.0',
	port:1771,
	gcInterval: 60*60*12,
	matchTimeout: 60*60*24*3,
	matchOverTimeout: 60*60*24,
	persistence: false,
	sslPath: false,
	redirectHttp: false,
	master: null,
	externalURL: '',
	heartbeatInterval: 30,
	captive: false,
	scenarios: 'scenarios'
}
httpUtils.parseArgs(process.argv.slice(2), cfg);
console.log(cfg);

//------------------------------------------------------------------

function ServerPelagium(topLevelPath, persistence) {

	this.makeid = function(len, prefix) {
		const possible = "ABCDEFGHKLMNPQRSTUVWXYZ123456789";
		const valuesPerChar = possible.length;
		let id;
		do {
			id = (typeof prefix === 'string') ? prefix : '';
			for(let i = id.length; i < len; ++i)
				id += possible.charAt(Math.floor(Math.random() * valuesPerChar));
		} while(this.matches.has(id));
		return id;
	}

	this.matchCreate = function(params) {
		let id = params.id = this.makeid(6);
		let sim = new Sim(params);
		if(sim.state!='running')
			return [ 400, 'invalid match parameters' ];
		console.log('new match', id, params);
	
		this.matches.set(id, { id:id, sim:sim, users:new Map() });
		++this.totalMatchCount;
		++this.currMatchCount;
		return [ 200, { match:id } ];
	}
	this.matchInsert = function(id, data) {
		if(this.matches.has(id)) {
			console.warn('cannot insert match id', id, ': id already exists.');
			return false;
		}
		let match = { id:id, sim:new Sim(data.sim), users:new Map() };

		let allIdsUnique = true;
		for(let i=0; i<data.users.length && allIdsUnique; ++i) {
			let userId = data.users[i][0];
			if(this.matches.has(userId)) {
				console.warn('cannot insert match id', id, ': user id', userId, 'already exists.');
				return false;
			}
			match.users.set(userId, data.users[i][1]);
		}
		this.matches.set( id, match );
		match.users.forEach(function(user, id) {
			this.matches.set( id, match );
		}, this);
		++this.totalMatchCount;
		++this.currMatchCount;
		return true;
	}
	this.matchDelete = function(id) {
		let match = this.matches.get(id);
		if(!match || id != match.id)
			return;
		match.users.forEach((value, key)=>{
			this.matches.delete(key);
		});
		this.matches.delete(id);
		if(this.storage)
			this.storage.removeItem(id);
		--this.currMatchCount;
	}
	this.matchSerialize = function(id) {
		let match = this.matches.get(id);
		if(!match || id != match.id)
			return null;
		return { sim:match.sim._serialize(), users:Array.from(match.users.entries()) };
	}

	this.getParties = function(match) {
		let parties = {};
		match.users.forEach((value, key)=>{
			let party = parties[value.party] = {};
			if(value.name)
				party.name = value.name;
			if(value.mode) {
				party.mode = value.mode;
				if(value.mode == 'AI')
					party.id = key;
			}
		});
		return parties;
	}

	this.availableMatches = function() {
		let data = { availableMatches:{}, hostName:os.hostname() };
		this.matches.forEach((match, id)=>{
			if(match.id!=id || match.sim.state!='running')
				return;
			let numPlayersMax = match.sim.numParties;
			let numPlayers = match.users.size;
			if(numPlayers < numPlayersMax)
				data.availableMatches[id] = numPlayersMax - numPlayers;
		});
		return data;
	}

	this.userCreate = function(match, params) {
		let numPlayersMax = match.sim.numParties;
		let numPlayers = match.users.size;
		if(numPlayers >= numPlayersMax)
			return [ 403, 'Additional players forbidden'];

		let party;
		if('party' in params) {
			let partyAvailable = true;
			match.users.forEach((user)=>{
				if(user.party == params.party)
					partyAvailable = false;
			});
			if(!partyAvailable)
				return [ 403, 'Party not available'];
			party = params.party;
		}
		else {
			let partyAvailable = Array(numPlayersMax+1).fill(true);
			match.users.forEach((user)=>{
				partyAvailable[user.party] = false;
			});
			for(let i=1; i<partyAvailable.length && party===undefined; ++i)
				if(partyAvailable[i])
					party = i;
		}

		let user = { party: party };
		user.id = this.makeid(6, match.id.substr(0,1)); 
		for(let key in { 'name':true, 'email':true, 'mode':true })
			if(key in params)
				user[key] = params[key];

		match.users.set( user.id, user );
		this.matches.set( user.id, match );

		console.log('match', match.id, 'new party:', user);
		let details = {};
		if(params.name)
			details.name = params.name;
		if(params.mode)
			details.mode = params.mode;
		match.sim._postPresenceEvent(user.party, 'join', details);
		return [ 200, {
			match:match.id,
			id:user.id,
			party:user.party,
			parties:this.getParties(match),
			navalUnitsAllowed: match.sim.navalUnitsAllowed
		} ];
	}

	this.resumeFrom = function(storage) {
		let keys = storage.keys();
		let numResumed = 0;
		keys.forEach((id)=>{
			let data = storage.getItem(id);
			if(data && this.matchInsert(id, data))
				++numResumed;
			else
				storage.removeItem(id);
		});
		console.log(numResumed, 'matches resumed');
	}

	this.collectGarbage = function() {
		let now = new Date()/1000.0;
		this.matches.forEach((match, id)=>{
			if(match.id!=id)
				return;
			if(match.sim.state=='over' && match.sim.lastUpdateTime+cfg.matchOverTimeout < now)
				this.matchDelete(id);
			else if(match.sim.lastUpdateTime+cfg.matchTimeout < now)
				this.matchDelete(id);
		});
	}

	this.usage = function() {
		return {
			matchesRunning: this.currMatchCount,
			matchesTotal: this.totalMatchCount,
			estimatedDiskUsage: this.currMatchCount*3+'kB' // 3kB per match
		}
	}

	this.handleRequest = function(req, path, params, resp) {
		const respond = httpUtils.respond;
		if(!path.length)
			return respond(resp, 400);

		const method = req.method;
		if(path.length==1) {
			if(method=='GET')
				return httpUtils.serveStatic(resp, 'static/index.html');
			if(method=='POST') // new match
				return respond(resp, this.matchCreate(params));
			return respond(resp, 405,'Method Not Allowed')
		}

		if(path.length==2) {
			let id = path[1];
			if(method=='GET') {
				if(id=='scenarios') {
					if(!('id' in params))
						return respond(resp, 200, Sim.visibleScenarios);
					const scenId = params.id;
					if(scenId in Sim.scenarios)
						return respond(resp, 200, Sim.scenarios[scenId]);
					return respond(resp, 200, Sim.createScenario({seed:scenId}));
				}
				else if(id=='availableMatches') {
					const remoteIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
					if(remoteIp=='127.0.0.1')
						return respond(resp, 200, this.availableMatches());
				}
			}

			let match = this.matches.get(id);
			if(method=='GET') { // reconnect
				if(!match || id==match.id)
					return respond(resp, 404, 'player not found');
				let user = match.users.get(id);
				console.log('match', match.id, 'reconnect:', user);
				match.sim._postPresenceEvent(user.party, 'reconnect');
				return respond(resp, 200, { match:match.id, id:user.id,
					party:user.party, parties:this.getParties(match) });
			}
			if(method=='POST') { // join
				if(!match || id!=match.id)
					return respond(resp, 404, 'match not found');
				return respond(resp, this.userCreate(match, params));
			}
			return respond(resp, 405,'Method Not Allowed')
		}

		let userId = path[1];
		let match = this.matches.get(userId);
		if(!match || match.id===userId)
			return respond(resp, 404, 'match not found');
		let user = match.users.get(userId);
		if(!user)
			return respond(resp, 404, 'player not found');

		let cmd = path[2];
		let sim = match.sim;

		if(!cmd || cmd[0]=='_' || !(cmd in sim) || (typeof sim[cmd]!='function'))
			return respond(resp, 405, 'invalid command');

		console.log(match.id, '<<', cmd, user.party);
		if(this.validator.has(cmd)) {
			let result = this.validator.validate(cmd, params);
			if(result!==true)
				return respond(resp, result[0], result[1]);
		}
		if(match.sim[cmd](user.party, params, (data, code)=>{
			if((data!==null) && (typeof data == 'object') && ('serialize' in data))
				data = data.serialize();
			respond(resp, code ? code : data ? 200 : 204, data);
		}) && this.storage) {
			this.storage.setItem(match.id, this.matchSerialize(match.id));
		}
		return true;
	}

	this.path = topLevelPath;
	this.matches = new Map();
	this.totalMatchCount = 0;
	this.currMatchCount = 0;
	this.validator = new JsonValidator(require('./pelagium.schema.json'));
	if(persistence) {
		this.storage = new Storage(persistence);
		this.resumeFrom(this.storage);
	}

	setInterval(()=>{ this.collectGarbage(); }, cfg.gcInterval * 1000);
}
Sim.loadScenarios(cfg.scenarios);
let serverPelagium = new ServerPelagium('pelagium', cfg.persistence);

//------------------------------------------------------------------

let server = httpUtils.createServer(cfg, (req, resp, url)=>{
	if(!url.path.length)
		return httpUtils.redirect(req, resp, url, { path:[ 'static', 'index.html' ] });

	//console.log(req.method, url.pathname, JSON.stringify(url.query));
	switch(url.path[0]) { // toplevel services:
	case 'ping':
		return httpUtils.respond(resp, 200, 'pong');
	case serverPelagium.path:
		if(url.path.length===1 && req.method==='GET')
			return httpUtils.redirect(req, resp, url, { path:[ 'static', 'index.html' ] });
		return serverPelagium.handleRequest(req, url.path, url.query, resp);
	case 'static':
	case 'labs':
		if(url.path.length==2)
			return httpUtils.serveStatic(resp, url.path[1], __dirname+'/'+url.path[0]);
		return false;
	case 'media':
		if(url.path.length==2)
			return httpUtils.streamMedia(resp, url.path[1], __dirname+'/'+url.path[0]);
		return false;
	case 'info':
		return server.usage(req, resp);
	case 'serviceworker.js':
		return httpUtils.serveStatic(resp, url.path[0], __dirname+'/static');
	}
	if(cfg.captive)
		return httpUtils.redirect(req, resp, url, { path:[ serverPelagium.path ] });
});
server.startTime = new Date();
server.getUsageData = function(cb) {
	this.getConnections((err, count)=>{
		let upMins = Math.floor(((new Date())-this.startTime)/1000/60);
		let sysUpMins = Math.round(os.uptime()/60);
		let data = {
			pelagium: serverPelagium.usage(),
			process: {
				memoryUsage: process.memoryUsage(),
				connections: count,
				startTime: server.startTime.toISOString(),
				upTime:Math.floor(upMins/60/24)+'d '+(Math.floor(upMins/60)%24)+'h '+(upMins%60)+'m'
			},
			system: {
				memoryFree: `${Math.round(os.freemem() / 1048576)}MB`,
				memoryTotal: `${Math.round(os.totalmem() / 1048576)}MB`,
				loadAvg: os.loadavg(),
				cpuCount: os.cpus().length,
				uptime: Math.floor(sysUpMins/60/24)+'d '+(Math.floor(sysUpMins/60)%24)+'h '+(sysUpMins%60)+'m'
			}
		}
		for(let id in data.process.memoryUsage)
			data.process.memoryUsage[id] = Math.round(data.process.memoryUsage[id]/1024)+'kB';
		if('cpuUsage' in process)
			data.process.cpuUsage = process.cpuUsage()
		cb(data);
	});
}
server.usage = function(req, resp) {
	this.getUsageData((data)=>{
		httpUtils.respond(resp, 200, data);
	});
	return true;
}

let serverHttp = null;
if(server.isHttps && cfg.redirectHttp) {
	serverHttp = httpUtils.createServer({ ip:cfg.ip, port:cfg.redirectHttp },
		(req, resp, url)=>{
			return httpUtils.redirect(req, resp, url, { protocol:'https:', code:301 });
		}
	);
}

if(cfg.master) {
	const sendHeartBeat = function(evt = 'heartbeat') {
		server.getUsageData((data)=>{
			data.evt = evt;
			if(cfg.externalURL)
				data.url = cfg.externalURL;
			httpUtils.post(cfg.master, data, (err)=>{
				if(err)
					return console.error('posting heartbeat failed:', err);
			});
		});
	}
	sendHeartBeat('startup');
	setInterval(sendHeartBeat, cfg.heartbeatInterval * 1000);
}

httpUtils.onShutdown(()=>{
	if(cfg.master) {
		const msg = cfg.externalURL ? { evt:'shutdown', url:cfg.externalURL } : { evt:'shutdown' };
		httpUtils.post(cfg.master, msg);
	}
	console.log( "shutting down." );
});
