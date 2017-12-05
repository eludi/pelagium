//--- animations ---------------------------------------------------
function AnimationSelected(tStart, unit, callback) {
	this.transform = function(tNow, transf) {
		var tFrac = tNow - this.tStart - 0.5;
		tFrac -= Math.floor(tFrac);
		var sc = Math.abs(tFrac - 0.5) * 0.5;
		transf.scx += sc;
		transf.scy += sc;
	}
	this.unit = unit;
	this.tStart = tStart;
	this.type = 'selected';
}

function AnimationMove(tStart, unit, destination, callback, cbData) {
	var vel = 2.0;
	this.transform = function(tNow, transf) {
		var deltaT = tNow - this.tStart;
		if(deltaT*vel >= this.distance) {
			if(Array.isArray(destination) && destination.length > 1) {
				this.x += this.dx * this.distance;
				this.y += this.dy * this.distance;
				transf.x = this.x;
				transf.y = this.y;

				var angle = MatrixHex.angleRad(destination[0], destination[1]);
				this.distance = MatrixHex.distCart(destination[0], destination[1]);
				this.dx = Math.sin(angle);
				this.dy = -Math.cos(angle);
				this.tStart = tNow;
				destination.shift();
			}
			else {
				this.unit.animation = null;
				if(callback)
					callback(this.unit, cbData);
				transf.x = this.x + this.dx * this.distance;
				transf.y = this.y + this.dy * this.distance;
			}
			return;
		}
		transf.x = this.x + this.dx * deltaT * vel;
		transf.y = this.y + this.dy * deltaT * vel;
	}
	this.unit = unit;
	var dest = Array.isArray(destination) ? destination[0] : destination;
	this.distance = MatrixHex.distCart(unit, dest);
	var angle = MatrixHex.angleRad(unit, dest);
	this.dx = Math.sin(angle);
	this.dy = -Math.cos(angle);
	this.x = 0;
	this.y = 0;
	this.tStart = tStart;
	this.type = 'move';
}

function AnimationExplode(tStart, unit, callback, cbData) {
	var vel = 1.5;
	this.transform = function(tNow, transf) {
		var deltaT = tNow - this.tStart;
		if(deltaT*vel>=1.0) {
			this.unit.animation = null;
			if(callback)
				callback(this.unit, cbData);
			transf.opacity = 0.0;
			return;
		}
		var sc = 1+deltaT*vel;
		transf.scx += sc;
		transf.scy += sc;
		transf.opacity = 1.0 - deltaT*vel;
	}
	this.unit = unit;
	this.tStart = tStart;
}

function AnimationSupport(tStart, unit, destination, callback, cbData) {
	var vel = 2.0;
	this.transform = function(tNow, transf) {
		var deltaT = tNow - this.tStart;
		if(deltaT*vel >= this.distance) {
			this.unit.animation = null;
			if(callback)
				callback(this.unit, cbData);
			return;
		}
		if(deltaT > 0.5*this.distance/vel)
			deltaT = 0.5*this.distance/vel - deltaT;
		transf.x = this.dx * deltaT * vel;
		transf.y = this.dy * deltaT * vel;
	}
	this.unit = unit;
	var dest = destination;
	this.distance = 0.7;
	var angle = MatrixHex.angleRad(unit, dest);
	this.dx = Math.sin(angle);
	this.dy = -Math.cos(angle);
	this.tStart = tStart;
	this.type = 'support';
}

function ProductionController(selector, unitColor, callback) {
	var element=document.querySelector(selector);

	this.setProduction = function(id, progress) {
		progress = progress ? progress/MD.Unit[id].cost : 0.0;
		if(progress > 1.0)
			progress = 1.0;
		for(var i=0, end=element.children.length; i<end; ++i) {
			var child = element.children[i];
			var toolId = child.dataset.id;
			var isSelected = (toolId == id);

			var canvas = child.firstElementChild;
			var dc = extendCanvasContext(canvas.getContext('2d'));
			dc.clearRect(0,0, canvas.width,canvas.height);

			var cx = canvas.width/2, cy=canvas.height/2;
			if(!isSelected)
				dc.circle(cx,cy, canvas.width*0.5, {fillStyle:'rgba(0,0,0,0.5)'});				
			else {
				dc.circle(cx,cy, canvas.width*0.4, {fillStyle:'rgba(0,0,0,0.5)'});

				dc.lineWidth = canvas.width*0.1;
				dc.beginPath();
				dc.strokeStyle='white';
				dc.arc(cx,cy, canvas.width*0.45, 1.5*Math.PI, 1.5*Math.PI+2*Math.PI*progress, false);
				dc.stroke();
				dc.strokeStyle='rgba(255,255,255,0.33)';
				dc.arc(cx,cy, canvas.width*0.45, 1.5*Math.PI+2*Math.PI*progress, 1.5*Math.PI+2*Math.PI, false);
				dc.closePath();
				dc.stroke();
				this.production = id;
			}
			var sz = 24;
			dc.save();
			dc.translate(0.5*(canvas.width-sz), 0.5*(canvas.height-sz));
			dc.beginPath();
			dc.rect(0,0, sz,sz);
			dc.clip();
			dc.fillStyle = unitColor;
			dc.fillRect(0,0, sz,sz);
			client.drawUnitSymbol(dc, toolId, sz,sz, sz/6, 'white');
			dc.restore();
		}
		return this;
	}
	this.setVisible = function(id, isVisible) {
		if(isVisible === undefined)
			isVisible = true;
		for(var i=0, end=element.children.length; i<end; ++i) {
			var child = element.children[i];
			if(child.dataset.id != id) 
				continue;
			child.style.display = isVisible ? 'inherit' : 'none';
			break;
		}
		return this;
	}

	for(var id in MD.Unit) {
		var unitType = MD.Unit[id];
		var item = document.createElement('li');
		item.dataset.id = id;

		var canvas = document.createElement('canvas');
		canvas.width = canvas.height = 48;
		item.appendChild(canvas);
		item.onclick = function(evt) {
			callback(evt.currentTarget.dataset.id);
			return true;
		}
		element.appendChild(item);
	}

	this.setProduction(); // initializes visualization
}

// --- client ------------------------------------------------------
client = {
	settings: {
		cellHeight:36,
		scales: [ 18, 26, 36, 52, 72 ]
	},
	init: function(credentials, sim) {
		this.background = document.getElementById('background');
		this.background.dc = extendCanvasContext(this.background.getContext("2d"));
		this.foreground = document.getElementById('foreground');
		this.foreground.dc = extendCanvasContext(this.foreground.getContext("2d"));
		this.vp = { x:0, y:0, width:1, height:1 };
		this.cellMetrics = MapHex.calculateCellMetrics(this.settings.cellHeight);
		this.resize();

		var self = this;
		window.onresize=function() { self.resize(); }
		eludi.addPointerEventListener(this.foreground, function(event) { self.handlePointerEvent(event); });
		eludi.addWheelEventListener(function(event) { self.viewZoomStep(-event.deltaY, event.x, event.y); });
		eludi.addKeyEventListener(window, function(event) { self.handleKeyEvent(event); });

		this.state = 'init';
		this.sim = sim;
		this.credentials = credentials;
		this.party = credentials.party;
		this.mapView = null;
		this.redrawMap = true;
		this.fov = null; // field of vision
		this.units = {};
		this.selUnit = null;
		this.selection = null;
		this.cursor = null;
		this.pointerEventStartTime = 0;
		this.time = 0;
		this.tLastUpdate = new Date()/1000.0;
		this.orders = [];
		this.simEvents = [];
		this.turn = 1;
		this.cache = new Cache('pelagium/client', this.credentials.id);
		this.workers = [];
		this.ai = this.cache.getItem('/ai') || {};
		for(let id in this.ai)
			this.spawnAI(this.ai[id]);


		this.btnMain = new ButtonController('#toolbar_main', function(evt) { self.handleUIEvent(evt); });
		this.btnMain.setMode('fwd').setBackground(MD.Party[this.party].color);
		document.getElementById('main_menu').addEventListener("click", function(event) {
			self.handleUIEvent({ type:event.target.dataset.id }); });
		document.getElementById('btn_menu').addEventListener("click", function(event) {
			self.handleUIEvent({ type:event.currentTarget.dataset.id }); });
		if(!document.fullscreenEnabled && !document.webkitFullscreenEnabled)
			document.querySelector('li[data-id="fullscreen"]').style.display = 'none';
		this.toolbarProduction = new ProductionController('#toolbar_production', MD.Party[this.party].color,
			function(unitType) { if(self.cursor) self.handleProductionInput(unitType, self.cursor.x, self.cursor.y); });
		this.toggleToolbar('main');
		eludi.click2touch();

		sim.getSimEvents(this.party, null, function(data) { self.handleSimEvents(data); });
		sim.getTerrain(this.party, null, function(data) {
			self.mapView = new MatrixHex(data);
			MapHex.finalizeAppearance(self.mapView);
			self.redrawMap = true;
			sim.getSituation(self.party, null, function(data) {
				self.handleSituation(data);
				// center view at own units:
				var cx=0, cy=0, numUnits=0;
				for(var id in self.units) {
					var unit = self.units[id];
					if(unit.party.id!=self.party)
						continue;
					cx += unit.x;
					cy += unit.y;
					++numUnits;
				}
				if(numUnits) {
					cx /= numUnits;
					cy /= numUnits;
					self.viewCenter(Math.round(cx), Math.round(cy));
				}
			});
		});
		this.update();
	},

	close: function(saveMatch) {
		if(saveMatch && this.state!='over') {
			return this.modalPopup('resume id: '+this.credentials.id, ['OK'], function() {
				eludi.openUrl(baseUrl, {}, false);
			});
		}
		eludi.openUrl(baseUrl, {}, false);
	},

	resize: function(scaleOnly) {
		var reservedWidth=0, reservedHeight=0;
		if(!('offsetX' in this.vp)) {
			this.vp.offsetX = 0.5*this.cellMetrics.r;
			this.vp.offsetY = 0;
		}
		if(!scaleOnly) {
			this.background.width = this.foreground.width = window.innerWidth-reservedWidth;
			this.background.height = this.foreground.height = window.innerHeight-reservedHeight;
		}
		this.vp.width = Math.ceil(1.25+this.background.width/this.cellMetrics.w);
		this.vp.height = Math.ceil(1.5+this.background.height/this.cellMetrics.h);
		this.redrawMap = true;
	},

	toggleFullScreen: function() {
		if(document.fullscreenEnabled) {
			if (!document.fullscreenElement)
				document.documentElement.requestFullscreen();
			else if(document.exitFullscreen)
				document.exitFullscreen();
		}
		else if(document.webkitFullscreenEnabled) {
			if (!document.webkitFullscreenElement)
				document.documentElement.webkitRequestFullscreen();
			else if(document.webkitExitFullscreen)
				document.webkitExitFullscreen();
		}
	},

	toggleMenu: function(onOrOff) {
		var m=document.getElementById('menus');
		if(onOrOff===undefined)
			m.style.display = (m.style.display=='none') ? '' : 'none';
		else
			m.style.display = onOrOff ? '' : 'none';
	},

	toggleToolbar: function(id) {
		if(id=='main' && id==this.currentToolbar)
			return;
		this.currentToolbar = id;
		eludi.switchToSibling('toolbar_'+id, '');
		
		if(id=='production' && this.cursor) {
			var tile = this.mapView.get(this.cursor.x, this.cursor.y);
			this.toolbarProduction.setProduction(tile.production, tile.progress);
		}
	},

	handlePointerEvent: function(event) {
		var offsetX = this.vp.offsetX-0.75*this.cellMetrics.r;
		var cellX = Math.floor((event.x-offsetX) / this.cellMetrics.w) + this.vp.x;
		var offsetY = this.vp.offsetY+((cellX%2) ? 0 : -0.5*this.cellMetrics.h);
		var cellY = Math.floor((event.y-offsetY) / this.cellMetrics.h) + this.vp.y;

		switch(event.type) {
		case 'start':
			if(event.id==1 && event.pointerType!='mouse') {
				this.panning = false;
				this.pointerEventStartTime = Date.now();
				this.pinch = [{x:this.prevX, y:this.prevY}, {x:event.x, y:event.y}];
			}
			else if(event.id==0) {
				this.pointerEventStartTime = Date.now();
				this.prevX = event.x;
				this.prevY = event.y;
			}
			break;
		case 'move':
			if(event.id>1 || !this.pointerEventStartTime) // ignore right mouse button / multi-touch
				return;
			if(this.pinch) {
				var dx = event.x - this.pinch[event.id].x, dy=event.y - this.pinch[event.id].y;
				var dist0 = Math.sqrt(Math.pow(this.pinch[1].x-this.pinch[0].x, 2)
					+ Math.pow(this.pinch[1].y-this.pinch[0].y, 2));
				this.pinch[event.id].x += dx;
				this.pinch[event.id].y += dy;
				var dist1 = Math.sqrt(Math.pow(this.pinch[1].x-this.pinch[0].x, 2)
					+ Math.pow(this.pinch[1].y-this.pinch[0].y, 2));
				var factor = dist1 / dist0;
				var centerX = Math.round((this.pinch[0].x+this.pinch[1].x)/2);
				var centerY = Math.round((this.pinch[0].y+this.pinch[1].y)/2);
				return this.viewZoom(factor, centerX, centerY, -dx/2, -dy/2);
			}
			var dx=this.prevX-event.x, dy=this.prevY-event.y;
			if(this.panning || (Math.pow(dx,2)+Math.pow(dy,2) >= Math.pow(this.cellMetrics.r,2)) ) {
				this.panning = true;
				this.prevX = event.x;
				this.prevY = event.y;
				this.viewPan(dx, dy);
			}
			break;
		case 'end':
			if(event.id>1 || !this.pointerEventStartTime) // ignore right mouse button / multi-touch
				return;
			else if(this.pinch || this.panning) {
				this.pinch = this.panning = false;
				this.redrawMap = true;
			}
			else
				this.handleMapInput('click', cellX, cellY);
			this.pointerEventStartTime=0;
		}
	},

	handleKeyEvent: function(event) {
		var self = this;
		var currentCursor = function() {
			if(!self.cursor)
				self.cursor = { x:self.vp.x + Math.floor(self.vp.width/2),
					y:self.vp.y + +Math.floor(self.vp.height/2) };
			return self.cursor;
		}
		var which = event.which || event.keyCode;
		switch(which) {
		default:
			console.log(' key '+which+' down');
			return;
		case 9: // tab
		case 27: // escape
		case 10009: // RETURN on Samsung remote control
			console.log('switch input target');
			this.btnMain.setFocus(true);
			// todo
			return;
		case 13: // enter
		case 32: // space
			if(!this.cursor)
				currentCursor();
			else
				this.handleMapInput('click', this.cursor.x, this.cursor.y);
			event.preventDefault(); 
			break;
		case 33: // pgup
			return this.viewZoomStep(-1);
		case 34: // pgdown
			return this.viewZoomStep(1);
		case 37: // left
			--currentCursor().x;
			break;
		case 38: // up 
			--currentCursor().y;
			break;
		case 39: // right
			++currentCursor().x;
			break;
		case 40: // down
			++currentCursor().y;
			break;
		case 122: // F11
			return this.toggleFullScreen();
		}
		if(this.cursor && !this.isInsideViewport(this.cursor, 1))
			this.viewCenter(this.cursor.x, this.cursor.y);
	},

	handleUIEvent: function(event) {
		switch(event.type) {
		case 'fwd':
			return this.dispatchOrders();
		case 'spinner':
			return this.sim.postOrders(this.party, [{type:'forceEvaluate'}], this.turn); // only devMode
		case 'pause':
			// todo
			break;
		case 'spinner':
			break; // ignore
		case 'fullscreen':
			this.toggleMenu(false);
			return this.toggleFullScreen();
		case "suspend":
			return this.close(true);
		case "capitulate":
			return this.capitulate();
		case "joinCredentials":
			return this.modalPopup('join id: '+this.credentials.match, ['OK']);
		case "spawnAI":
			return this.spawnAI();
		case 'toggleMenu':
			return this.toggleMenu();
		default:
			console.error('unhandled UI event', event);
		}
	},

	handleProductionInput: function(unitType, x, y) { 
		if(this.state!='input')
			return;
		var tile = this.mapView.get(x, y);
		if(!tile || tile.terrain!=MD.OBJ || tile.party != this.party || tile.production==unitType || !(unitType in MD.Unit))
			return;

		this.addOrder({ type:'production', unit:unitType, x:x, y:y });
		tile.production = unitType;
		tile.progress = 0;
		this.toolbarProduction.setProduction(unitType, 0.0);
	},

	handleMapInput: function(type, cellX, cellY) {
		if(this.state!='input')
			return;
		this.cursor = { x:cellX, y:cellY };
		if(this.selUnit && this.isSelected(cellX, cellY) && !this.selUnit.origin
			&& !(this.selUnit.animation && this.selUnit.animation.type=='move'))
		{
			this.toggleToolbar('main');
			return this.moveUnit(this.selUnit, cellX, cellY);
		}

		var tile = this.mapView.get(cellX, cellY);
		if(!tile)
			return;

		if(tile.terrain == MD.OBJ && tile.party == this.party)
			this.toggleToolbar('production');
		else
			this.toggleToolbar('main');

		if(!tile.unit || (this.selUnit == tile.unit))
			this.deselectUnit();
		else
			this.selectUnit(tile.unit);

		var msg = '('+cellX+','+cellY+') ';
		if(tile.party)
			msg += MD.Party[tile.party].name+' ';
		msg += MD.Terrain[tile.terrain].name;
		if(tile.unit) {
			msg += ', ' + tile.unit.party.name + ' ' + tile.unit.type.name;
			if(tile.unit.origin)
				msg += ', moved';
		}

		this.displayStatus(msg);
		this.draw(true);
	},

	viewZoomStep: function(delta, centerX, centerY) {
		var i, scales = this.settings.scales;
		for(i=0; i<scales.length; ++i) 
			if(this.cellMetrics.h==scales[i])
				break;
		var scale = this.cellMetrics.h;
		if(delta<0 && i>0)
			scale = scales[i-1];
		else if(delta>0 && i+1<scales.length)
			scale = scales[i+1];
		if(this.cellMetrics.h != scale) {
			var factor = scale / this.cellMetrics.h;
			if(centerX===undefined)
				centerX = this.background.width/2;
			if(centerY===undefined)
				centerY = this.background.height/2;
			this.viewZoom(factor, centerX, centerY);
		}
	},

	viewZoom: function(factor, centerX, centerY, deltaX, deltaY) {
		var scales = this.settings.scales;
		var scale = factor * this.cellMetrics.h;
		var scaleMin = scales[0], scaleMax = scales[scales.length-1];
		if(scale < scaleMin)
			scale = scales[0];
		else if(scale > scaleMax)
			scale = scaleMax;
		if(scale == this.cellMetrics.h)
			return;
		var dx = centerX * (factor-1.0) + (deltaX!==undefined ? deltaX : 0);
		var dy = centerY * (factor-1.0) + (deltaY!==undefined ? deltaY : 0);
		this.cellMetrics = MapHex.calculateCellMetrics(scale);
		this.resize(true);
		this.viewPan(dx, dy);
	},

	viewPan: function(dX, dY) {
		var vp = this.vp;
		var cm = this.cellMetrics;
		vp.offsetX -= dX;
		vp.offsetY -= dY;
		vp.x -= (vp.offsetX>=0) ? 
			Math.floor(vp.offsetX / cm.w) : Math.ceil(vp.offsetX / cm.w);
		vp.y -= (vp.offsetY>=0) ?
			Math.floor(vp.offsetY / cm.h) : Math.ceil(vp.offsetY / cm.h);
		vp.offsetX %= cm.w;
		vp.offsetY %= cm.h;
		if(vp.offsetX>0.5*cm.r) {
			vp.offsetX -=cm.w;
			--vp.x;
		}
		if(vp.offsetY>0) {
			vp.offsetY -=cm.h;
			--vp.y;
		}
		this.redrawMap = true;
	},

	viewCenter: function(x, y) {
		this.vp.x = Math.round(x-this.vp.width/2);
		this.vp.y = Math.round(y-this.vp.height/2);
		this.redrawMap = true;
	},

	isInsideViewport: function(pos, delta) {
		if(!delta)
			delta=0;
		return pos.x >= this.vp.x + delta
			&& pos.y >= this.vp.y + delta
			&& pos.x < this.vp.x + this.vp.width - delta
			&& pos.y < this.vp.y + this.vp.height - delta;
	},

	selectUnit: function(unit) {
		if(this.selUnit == unit || (unit && this.party != unit.party.id) || unit.origin)
			return;
		this.deselectUnit();
		if(unit) {
			this.selUnit = unit;
			unit.animation = new AnimationSelected(this.time, this.unit);
			this.selection = unit.getFieldOfMovement(this.mapView);
		}
	},
	deselectUnit: function() {
		if(!this.selUnit)
			return;
		this.selUnit.animation = null;
		this.selUnit = null;
		this.selection = null;
	},
	isSelected: function(x, y) {
		if(!this.selection)
			return false;
		for(var i=0, end=this.selection.length; i!=end; ++i) {
			var tile = this.selection[i];
			if(tile.x==x && tile.y==y)
				return true;
		}
		return false;
	},

	addOrder: function(order) {
		this.orders.push(order);
		this.cache.setItem('/orders', { turn:this.turn, orders:this.orders });
		console.log('order', order);
	},
	dispatchOrders: function() {
		if(this.state!='input')
			return;
		this.sim.postOrders(this.party, this.orders, this.turn);
		this.cache.removeItem('/orders');
		this.orders = [];
		for(var id in this.units) {
			var unit = this.units[id];
			if(!unit.origin)
				continue;
			unit.x = unit.origin.x;
			unit.y = unit.origin.y;
			delete unit.origin;
		}
		this.switchState('waiting');
	},
	restoreOrders: function() {
		var cachedOrders = this.cache.getItem('/orders');
		if(!cachedOrders)
			return;
		if(cachedOrders.turn != this.turn)
			return this.cache.removeItem('/orders');
		this.orders = cachedOrders.orders;
		this.orders.forEach(function(order, i) {
			if(order.type=='production') {
				var tile = this.mapView.get(order.x, order.y);
				if(!tile || tile.terrain!=MD.OBJ || tile.party != this.party || !(order.unit in MD.Unit))
					return;
				tile.production = order.unit;
				tile.progress = 0;
			}
			else if(order.type=='move') {
				var unit = this.mapView.get(order.from_x, order.from_y).unit;
				if(!unit || unit.id != order.unit || this.party != unit.party.id)
					return;
				this.displayUnitDestination(unit, order);
			}
		}, this);
	},

	moveUnit: function(unit, x, y) {
		var order = { type:'move', unit:unit.id, from_x:unit.x, from_y:unit.y, to_x:x, to_y:y };
		this.addOrder(order);

		this.selection = this.selUnit = null;

		// animate until unit is drawn at its new destination:
		var self = this;
		var path = unit.getPath(this.mapView, x,y);
		unit.animation = new AnimationMove(this.time, unit, path, function(unit, order) {
			self.displayUnitDestination(unit, order);
		}, order);
	},
	displayUnitDestination: function(unit, order) {
		delete this.mapView.get(order.from_x, order.from_y).unit;
		unit.origin = { x:unit.x, y:unit.y };
		unit.x = order.to_x;
		unit.y = order.to_y;
		this.mapView.get(order.to_x, order.to_y).unit = unit;
	},

	capitulate: function() {
		if(this.state == 'over' || this.state=='init')
			return;
		var self = this;
		this.modalPopup("really surrender?", ["yes", "no"], function(result){
			if(result==1)
				return;
			self.orders = [{ type:'capitulate', party:self.party }];
			self.state='input';
			self.dispatchOrders();
			self.switchState('over');
			setTimeout(function() { self.close(); }, 0);
		});
	},

	drawUnit: function(dc, unit) {
		if(unit.state=='dead')
			return;
		var cellX = unit.x;
		var cellY = unit.y;

		var scale = this.cellMetrics.r;
		var transf = { x:0.0, y:0.0, r:0.0, scx:1.0, scy:1.0, opacity:1.0 };
		if(unit.animation && (this.state=='input' || this.state=='replay'))
			unit.animation.transform(this.time, transf);
		var w=scale*transf.scx, h=scale*transf.scy;

		var x=(transf.x+cellX-this.vp.x)*this.cellMetrics.w+this.vp.offsetX - w/2;
		var y=(transf.y+cellY-this.vp.y)*this.cellMetrics.h+this.vp.offsetY + ((cellX%2) ? 0.5*this.cellMetrics.h : 0) - h/2;

		var sprite = document.createElement('canvas'); // todo, maybe prerender all sprites at double resolution?
		sprite.width = w;
		sprite.height = h;
		var sdc = extendCanvasContext(sprite.getContext('2d'));
		sdc.fillStyle = unit.party.color;
		sdc.fillRect(0,0, w, h);
		this.drawUnitSymbol(sdc, unit.type.id, w,h, scale*transf.scx/6, 'white');

		dc.save();
		dc.globalAlpha = transf.opacity;
		dc.shadowColor='rgba(0,0,0,0.4)';
		dc.shadowOffsetX=sdc.lineWidth/2;
		dc.shadowOffsetY=sdc.lineWidth/2;
		dc.shadowBlur = sdc.lineWidth/2;
		dc.drawImage(sprite, x,y, w, h);
		dc.restore();
	},

	drawUnitSymbol: function(dc, type, w,h, lineWidth, color) {
		dc.strokeStyle = color;
		dc.lineWidth = lineWidth;
		switch(type) {
		case 'inf':
			dc.strokeLine(0,0, w,h);
			dc.strokeLine(0,h, w,0);
			break;
		case 'kv':
			dc.strokeLine(0,h, w,0);
			break;
		case 'art':
			dc.circle(w/2,h/2, 1.25*lineWidth, {fillStyle:color});
			break;
		}
	},

	drawSelTile: function(dc, tile) {
		var x = tile.x;
		var y = tile.y;
		var offsetY = this.vp.offsetY;
		if(x%2) 
			offsetY+=0.5*this.cellMetrics.h;
		var radius = this.cellMetrics.r/6;
		dc.circle((x-this.vp.x)*this.cellMetrics.w+this.vp.offsetX,
			(y-this.vp.y)*this.cellMetrics.h+offsetY, radius,
			{ fillStyle:tile.fillStyle ? tile.fillStyle : 'rgba(0,0,0, 0.33)' });
	},

	draw: function() {
		var fastMode = (this.panning || this.pinch) ? true : false;
		var vp = this.vp;

		this.foreground.dc.clearRect( 0 , 0 , this.foreground.width, this.foreground.height );

		if(this.redrawMap && this.mapView) { // background:
			this.redrawMap = false;
			MapHex.draw(this.background, this.mapView, vp, this.cellMetrics, this.fov, fastMode);
		}
		if(fastMode)
			return;

		// foreground:
		dc = this.foreground.dc;
		for(var id in this.units) {
			var unit = this.units[id];
			if(this.isInsideViewport(unit) && unit!=this.selUnit)
				this.drawUnit(dc, unit);
		}
		if(this.selUnit)
			this.drawUnit(dc, this.selUnit);

		if(this.selection)
			for(var i=this.selection.length; i--; )
				this.drawSelTile(dc, this.selection[i]);

		if(this.cursor && this.isInsideViewport(this.cursor) && (!this.selUnit || this.cursor.x!=this.selUnit.x || this.cursor.y!=this.selUnit.y)) {
			var x = this.cursor.x-vp.x;
			var y = this.cursor.y-vp.y;
			var offsetY = vp.offsetY + ((this.cursor.x%2) ? 0.5*this.cellMetrics.h : 0);
			var cx=x*this.cellMetrics.w+vp.offsetX, cy= y*this.cellMetrics.h+offsetY;
			var lineWidth = this.cellMetrics.r/8;
			var r = 0.5*this.cellMetrics.h-0.5*lineWidth;
			var deltaR = 0.07*r*Math.sin(this.time*1.5*Math.PI);
			dc.circle(cx, cy, r+deltaR, { strokeStyle: 'white', lineWidth:lineWidth });
		}
	},

	update: function() {
		var tNow = new Date()/1000.0;

		if((this.state=='input' || this.state=='replay')) {
			var deltaT = Math.min(tNow-this.tLastUpdate, 0.1);
			this.time += deltaT;
		}

		this.tLastUpdate = tNow;
		this.draw();
		var self = this;
		requestAnimationFrame(function() { self.update(); });
	},

	handleSimEvents: function(events) {
		for(var i=0; i<events.length; ++i)
			this.simEvents.push(events[i]);
		this.switchState('replay');
	},

	handleSituation: function(data) {
		for(var i=0; i<this.mapView.data.length; ++i) {
			var tile = this.mapView.data[i];
			delete tile.unit;
			delete tile.party;
			delete tile.production;
			delete tile.progress;
		}

		this.units = { };
		for(var i=0; i<data.units.length; ++i) {
			var unit = data.units[i];
			var tile = this.mapView.get(unit.x, unit.y);
			tile.unit = this.units[unit.id] = new Unit(unit);
		}
		if(this.selUnit)
			this.selectUnit(this.units[this.selUnit.id]);

		for(var i=0; i<data.objectives.length; ++i) {
			var obj = data.objectives[i];
			var tile = this.mapView.get(obj.x, obj.y);
			tile.party = obj.party;
			if(obj.production) {
				tile.production = obj.production;
				tile.progress = obj.progress;
			}
		}

		this.fov = new MatrixHex(data.fov);

		this.redrawMap = true;
		this.turn = data.turn;
		this.restoreOrders();

		if(data.state=='running')
			this.switchState(data.ordersReceived ? 'waiting' : 'input');
		else
			this.switchState(data.state);
	},

	updateProduction: function(numTurns) {
		for(var i=0; i<this.mapView.data.length; ++i) {
			var tile = this.mapView.data[i];
			if(tile.production)
				tile.progress += numTurns;
		}
	},

	nextSimEvent: function() {
		var self = this;
		if(this.state!='over' && this.simEvents.length) {
			this.selection = null;
			if(!this.applyEvent(this.simEvents.shift()))
				setTimeout(function() { self.nextSimEvent(); }, 0);
		}
		else // todo, roundtrip may be avoided if events are complete
			this.sim.getSituation(this.party, null, function(data) { self.handleSituation(data); });
	},

	applyEvent: function(evt) {
		let unit = ('unit' in evt) ? evt.unit : null;
		if(unit!==null&&(typeof evt.unit!='object')) {
			unit = this.units[unit];
			if(!unit || unit.state=='dead')
				return console.error('event refers to unknown unit:', evt);
		}

		var self = this;
		switch(evt.type) {
		case 'retreat':
		case 'move': {
			console.log('event', evt);
			unit.x = evt.from_x;
			unit.y = evt.from_y;

			if(evt.type=='retreat')
				this.displayStatus(MD.Party[unit.party.id].name+' '+unit.type.name+' retreats');
			
			if(!this.isInsideViewport(unit, 2))
				this.viewCenter(unit.x, unit.y);

			unit.animation = new AnimationMove(this.time, unit, {x:evt.to_x, y:evt.to_y},
				function(unit, evt) {
					delete self.mapView.get(evt.from_x, evt.from_y).unit;
					unit.x = evt.to_x;
					unit.y = evt.to_y;
					self.mapView.get(unit.x, unit.y).unit = unit;
					self.nextSimEvent();
				}, evt);
			return true;
		}
		case 'support': {
			console.log('event', evt);
			unit.animation = new AnimationSupport(this.time, unit, evt, function(unit) {
				self.nextSimEvent();
			});
			return true;
		}
		case 'combat': {
			console.log('event', evt);
			var winner = this.units[evt.winner];
			if(winner)
				this.notify(MD.Party[winner.party.id].name+' '+winner.type.name+' prevails at ('+evt.x+','+evt.y+')', 4.0);
			if(!this.isInsideViewport(evt, 1))
				this.viewCenter(evt.x, evt.y);
			return false;
		}
		case 'surrender': {
			console.log('event', evt);
			if(unit == this.selUnit)
				this.selUnit = null;

			unit.animation = new AnimationExplode(this.time, unit, function(unit) {
				unit.state = 'dead';
				self.nextSimEvent();
			});
			return true;
		}
		case 'capture': {
			console.log('event', evt);
			var tile = this.mapView.get(evt.x, evt.y);
			tile.party = evt.party;
			tile.production = 'inf';
			tile.progress = -1;
			this.notify(MD.Party[evt.party].name+' captures objective at ('+evt.x+','+evt.y+')', 4.0);

			if(!this.isInsideViewport(evt, 1))
				this.viewCenter(evt.x, evt.y);
			this.redrawMap = true;
			return false;
		}
		case 'gameOver': {
			console.log('event', evt);
			this.switchState('over');
			var msg = 'GAME OVER!<br/>And the winner is... '+MD.Party[evt.winners[0]].name;
			var self = this;
			this.modalPopup(msg, ["OK"], function() { self.close(); } );
			return false;
		}
		case 'turn': {
			console.log('event', evt);
			this.updateProduction(evt.turn - this.turn);
			this.turn = evt.turn;
			return false;
		}
		case 'contact': {
			console.log('event', evt);
			var tile = this.mapView.get(evt.x, evt.y);
			tile.unit = this.units[evt.unit.id] = new Unit(evt.unit);
			this.redrawMap = true;
			return false;
		}
		case 'contactLost': {
			console.log('event', evt);
			var tile = this.mapView.get(evt.x, evt.y);
			if(tile.unit && tile.unit.id === evt.unit)
				delete tile.unit;
			delete this.units[evt.unit];
			this.redrawMap = true;
			return false;
		}
		case 'capitulate':
		case 'production':
		case 'productionBlocked':
		case 'blocked':
			// todo
		default:
			console.warn('unhandled sim event', evt);
		}
		return false;
	},

	switchState: function(state, params) {
		if(state==this.state || this.state=='over')
			return;

		this.toggleToolbar('main');
		switch(state) {
		case 'input': {
			var selUnitId = this.selUnit ? this.selUnit.id : 0;
			this.selection = null;
			this.redrawMap = true;
			this.selUnit = selUnitId ? this.units[selUnitId] : null;
			if(this.selUnit)
				this.selUnit.animation = new AnimationSelected(this.time, this.selUnit);
			else
				this.cursor = null;
			this.btnMain.setMode('fwd').setBackground(MD.Party[this.party].color);
			var msg = 'turn '+this.turn+' '+MD.Party[this.party].name;
			if(this.turn==1)
				msg += ' &nbsp; join id: '+this.credentials.match;
			this.displayStatus(msg);
			break;
		}

		case 'waiting':
			this.btnMain.setMode('spinner');
			this.displayStatus('turn '+this.turn+', waiting for events...');
			this.deselectUnit();
			break;

		case 'replay':
			this.cursor = null;
			this.btnMain.setMode('pause');
			this.displayStatus('turn '+this.turn);
			this.nextSimEvent();
			break;
		
		case 'over': {
			this.selUnit = null;
			if(localStorage)
				delete localStorage.pelagium;
			break;
		}
		default:
			return console.error('unhandled application state', state);
		}
		this.state = state;
	},

	spawnAI: function(id) {
		let ai = new Worker('/static/ai.js');
		this.workers.push(ai);
		let self = this;
		ai.onmessage = function(msg) {
			let evt = msg.data.type;
			let data = msg.data.data;
			if(evt=='credentials') {
				self.ai[data.party] = data.id;
				self.cache.setItem('/ai', self.ai );
				self.displayStatus('AI opponent has joined as '+MD.Party[data.party].name);
			}
			else if(evt=='error') {
				self.displayStatus('AI ERROR: '+data);
			}
		}
		ai.postMessage({ cmd:id?'resume':'join', id:id?id:this.credentials.match });
		document.querySelector('li[data-id="spawnAI"]').style.display = 'none';
		document.querySelector('li[data-id="joinCredentials"]').style.display = 'none';
		this.toggleMenu(false);
	},

	displayStatus: function(msg) {
		document.getElementById("status").innerHTML = msg;
	},
	notify: function(msg, duration) {
		document.getElementById("status").innerHTML = msg;
		if(duration) {
			setTimeout(function() {
				var elem = document.getElementById("status");
				if(elem.innerHTML == msg)
					elem.innerHTML = '';
			}, duration*1000);
		}
	},
	modalPopup: function(msg, choices, callback) {
		var popup = document.getElementById('popup');
		if(!msg) {
			popup.style.display = 'none';
			return;
		}
		this.toggleMenu(false);
		popup.firstElementChild.firstElementChild.innerHTML = msg;

		var ul = popup.firstElementChild.lastElementChild;
		ul.innerHTML = '';

		var items = [];
		for(var i=0; i<choices.length; ++i) {
			var item = document.createElement('li');
			item.appendChild(document.createTextNode(choices[i]));
			item.dataset.id = i;
			item.onclick = function(event) {
				popup.style.display = 'none';
				if(callback)
					callback(event.target.dataset.id);
			}
			ul.appendChild(item);
			items.push(item);
		}
		eludi.click2touch(items);
		popup.style.display = '';
	}
}

function main(params) {
	var sim = new SimProxy(params, function(credentials, sim) {
		client.init(credentials, sim);
	});
	sim.on('error', function(evt, msg) {
		client.modalPopup(msg, ['OK'], function(id) { client.close(); });
	});
	sim.on('warn', function(evt, msg) { client.displayStatus(msg); });
}
