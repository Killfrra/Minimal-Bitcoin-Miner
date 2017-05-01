importScripts('sha256d.js')
var cmd = {
	get_work 	: 0,
	send_share	: 1,
	new_work	: 2
}
var _batchSize = 1000000;
var hash,_nonce,max,target,deadline;
onmessage = function(e){
	if(e.data[0] == cmd.new_work){
		_nonce		= e.data[1];
		max 		= e.data[2];
		half[0]		= e.data[3];
		half[1]		= e.data[4];
		half[2]		= e.data[5];
		midstate	= e.data[6];
		target		= e.data[7];
		deadline	= e.data[8];
	}
	var _lastPrint = Date.now();
	while (Date.now() <= deadline) {
		for (let batchSize = _batchSize; batchSize > 0; batchSize--) {
			hash = sha256d(_nonce);
			//count trailing bytes that are zero
			for (let i = 7; i >= 0; i--) {
				if ((hash[i] >>> 0) > (target[i] >>> 0))break;
				if ((hash[i] >>> 0) < (target[i] >>> 0)){ //share difficulty matched!
					console.log("*** Found Valid Share ***");
					postMessage([cmd.send_share,_nonce]);
					return;
				}
			}
			//increase
			if (++_nonce == max){
				postMessage([cmd.get_work]);
				return;
			}
		}
		console.log("Speed: " + Math.floor((_batchSize) / (Date.now() - _lastPrint)) + " Kh/s");
		_lastPrint = Date.now();
	}
	console.log("Work outdated");
	postMessage([cmd.get_work]);
}