function extendCanvasContext(dc) {
	dc.circle = function(x,y,r, style) {
		if(style!==undefined) for(var key in style)
			this[key] = style[key];
		this.beginPath();
		this.arc(x,y, r, 0, 2*Math.PI, true);
		this.closePath();
		if(style.fillStyle) this.fill();
		if(style.strokeStyle) this.stroke();
	}
	dc.strokeCircle=function(x,y,r) {
		this.beginPath();
		this.arc(x,y, r, 0, 2*Math.PI, true);
		this.closePath();
		this.stroke();
	}
	dc.strokeLine=function(x1,y1,x2,y2) {
		this.beginPath();
		this.moveTo(x1,y1);
		this.lineTo(x2,y2);
		this.stroke();
	}
	dc.dashedLine = function(x, y, x2, y2, da) {
		if (!da) da = [10,5];
		this.save();
		var dx = (x2-x), dy = (y2-y);
		var len = Math.sqrt(dx*dx + dy*dy);
		var rot = Math.atan2(dy, dx);
		this.translate(x, y);
		this.moveTo(0, 0);
		this.rotate(rot);
		var dc = da.length;
		var di = 0, draw = true;
		x = 0;
		while (len > x) {
			x += da[di++ % dc];
			if (x > len) x = len;
			draw ? this.lineTo(x, 0): this.moveTo(x, 0);
			draw = !draw;
		}
		this.restore();
	}
	dc.hex = function(x,y,r, style) {
		var rx = r/2, ry = Math.sin(Math.PI/3)*r;
		if(style!==undefined) for(var key in style)
			this[key] = style[key];

		this.beginPath();
		this.moveTo(x-rx,y-ry);
		this.lineTo(x-r,y);
		this.lineTo(x-rx,y+ry);
		this.lineTo(x+rx,y+ry);
		this.lineTo(x+r,y);
		this.lineTo(x+rx,y-ry);
		this.closePath();
		if(style.fillStyle)
			this.fill();
		if(style.strokeStyle)
			this.stroke();
	}
	dc.strokeUnit = function(type, w,h, lineWidth, color) {
		this.strokeStyle = color;
		this.lineWidth = lineWidth;
		switch(type) {
		case 'inf':
			this.strokeLine(0,0, w,h);
			this.strokeLine(0,h, w,0);
			break;
		case 'kv':
			this.strokeLine(0,h, w,0);
			break;
		case 'art':
			this.circle(w/2,h/2, 1.25*lineWidth, {fillStyle:color});
			break;
		}
	}

	return dc;
}

//--- animations ---------------------------------------------------
function AnimationSelected(tStart, unit, callback) {
	this.transform = function(tNow, transf) {
		var tFrac = tNow - this.tStart - 0.5;
		tFrac -= Math.floor(tFrac);
		transf.scx = transf.scy = 1.0 + Math.abs(tFrac - 0.5) * 0.5;
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
		transf.scx = transf.scy = 1.0 + deltaT*vel;
		transf.opacity = 1.0 - deltaT*vel;
	}
	this.unit = unit;
	this.tStart = tStart;
	this.type = 'explode';
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

//--- renderer -----------------------------------------------------
function RendererSprites(dc, size) {
	const sz = size*Math.tan(Math.PI/6);
	const lineWidth = sz/6;
	const partySpriteSz = Math.floor(sz+lineWidth*1.5);
	const partySpriteFactor = partySpriteSz/sz;

	function initUnitSprites() {
		let sprites = {};
		for(let id in MD.Unit) {
			let sprite = document.createElement('canvas');
			sprite.width = sprite.height = sz;
			let dc = extendCanvasContext(sprite.getContext('2d'));
			dc.strokeUnit(id, sz,sz, lineWidth, 'white');
			sprites[id] = sprite;
		}
		return sprites;
	}
	function initPartySprites() {
		const shadowR = lineWidth/2;
		let sprites = {};
		for(let id in MD.Party) {
			let party = MD.Party[id];
			let sprite = document.createElement('canvas');
			sprite.width = sprite.height = partySpriteSz;
			let dc = sprite.getContext('2d');

			dc.shadowColor='rgba(0,0,0,0.4)';
			dc.shadowOffsetX = shadowR;
			dc.shadowOffsetY = shadowR;
			dc.shadowBlur = shadowR;
			dc.fillStyle = party.color;
			dc.fillRect(0,0, sz,sz);

			sprites[id] = sprite;
		}
		return sprites;
	}

	this.drawUnit = function(party, id, x,y, w,h, symbolOpacity) {
		let sprite = this.partySprites[party];
		this.dc.drawImage(sprite, x,y, w*partySpriteFactor, h*partySpriteFactor);

		sprite = this.unitSprites[id];
		if(symbolOpacity!==undefined) {
			this.dc.save();
			this.dc.globalAlpha *= symbolOpacity;
		}
		this.dc.drawImage(sprite, x,y, w,h);
		if(symbolOpacity!==undefined)
			this.dc.restore();
	}
	this.unitSprites = initUnitSprites();
	this.partySprites = initPartySprites();
	this.dc = dc;
}

function RendererAdhoc(dc) {
	this.drawUnit = function(party, id, x,y, w,h, symbolOpacity) {
		let lineWidth = w/6;
		dc.save();
		dc.shadowColor='rgba(0,0,0,0.4)';
		dc.shadowOffsetX = lineWidth/2;
		dc.shadowOffsetY = lineWidth/2;
		dc.shadowBlur = lineWidth/2;
		dc.fillStyle = MD.Party[party].color;
		dc.fillRect(x,y, w, h);
		dc.restore();

		dc.save();
		dc.translate(x,y);
		dc.beginPath();
		dc.rect(0,0, w,h);
		dc.clip();
		dc.strokeUnit(id, w,h, lineWidth, 'rgba(255,255,255,'+symbolOpacity+')');
		dc.restore();
	}
}