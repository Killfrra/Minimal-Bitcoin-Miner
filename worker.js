importScripts('sha256d.js')
var cmd = {
	new_work : 0,
	send_share : 1,
	finished : 2,
	update : 3
}
var _batchSize = 1000000;
var hash,max,_nonce,target;
onmessage = function(arg){
	if(arg.data[0] == cmd.new_work){
		_nonce 	 = arg.data[1];
		max	 = arg.data[2];
		half[0]  = arg.data[3];
		half[1]  = arg.data[4];
		half[2]  = arg.data[5];
		midstate = arg.data[6];
		target   = arg.data[7];
	}
	for (let batchSize = _batchSize; batchSize > 0; batchSize--) {
		hash = sha256d(_nonce);
		//count trailing bytes that are zero
		for (let i = 7; i >= 0; i--) {
			if ((hash[i] >>> 0) > (target[i] >>> 0))break;
			if ((hash[i] >>> 0) < (target[i] >>> 0)){ //share difficulty matched!
				postMessage([cmd.send_share,_nonce]);
				return;
			}
		}
		//increase
		if (++_nonce == max){
			postMessage([cmd.finished]);
			break;
		}
	}
	postMessage([cmd.update,_nonce]);
}