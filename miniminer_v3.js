var debug = true;
var Utils = {
	stringToInts: function (input) {
		var ints = new Int32Array(input.length / 8);
		for (let i = 0, j = 0; i < input.length; j++, i += 8)
			ints[j] = parseInt(input.substr(i, 8), 16);
		return ints;
	},
	intsToString: function (input) {
		var result = "";
		for (let i = 0; i < input.length; i++) result += this.intToString(input[i]);
		return result;
	},
	intToString: function (value) {
		return (((value >>> 24) & 0xff).toString(16) + ((value >>> 16) & 0xff).toString(16) + ((value >>> 8) & 0xff).toString(16) + (value & 0xff).toString(16));
	},
	EndianFlip32BitChunks: function (input) {
		//32 bits = 4 bytes = 8 chars?
		var result = "";
		for (let i = 0; i < input.length; i += 8)
			for (let j = 0; j < 8; j += 2) {
				//append byte (2 chars)
				result += input[i - j + 6];
				result += input[i - j + 7];
			}
		return result;
	},
	RemovePadding: function (input) {
		//payload length: final 64 bits in big-endian - 0x0000000000000280 = 640 bits = 80 bytes = 160 chars
		return input.substr(0, 160);
	},
	AddPadding: function (input) {
		//add the padding to the payload. It never changes.
		return input + "000000800000000000000000000000000000000000000000000000000000000000000000000000000000000080020000";
	}
};

var Data ,target, _ticks;

var _averageSpeed = 0; //hs
var login = "1BhKdW7omrkQrWa3VtS8PwtDuMDCK2uRu1:ANYTHING@localhost:80/getwork.php";
var urlStart = login.indexOf('@');
var passwordStart = login.indexOf(':');
var Url = "http://" + login.substr(urlStart + 1);
var User = login.substr(0, passwordStart);
var Password = login.substr(passwordStart + 1, urlStart - passwordStart - 1);
var _maxAge = 20000; //ms
var xhr = new XMLHttpRequest();
var retryTime = 30000;

var pc = 2;
var hpt = 4294967296 / pc;
var threads = new Array(pc);

var cmd = {
	get_work 	: 0,
	send_share	: 1,
	new_work	: 2
}
var fresh_data = 0;
function init(){
	for(let i = 0; i < pc; i++){
		threads[i] = new Worker('worker.js');
		threads[i].idle = true;
		threads[i].onmessage = function(e){
			if(e.data[0] == cmd.get_work){
				if(fresh_data != 0){
					fresh_data--;
					update_data(i);
				}else{
					threads[i].idle = true;
					GetWork(true);
				}
			}else if(e.data[0] == cmd.send_share){
				threads[i].idle = true;
				SendShare(e.data[1]);
				GetWork(true);
			}
		}
	}
}

function update_data(i){
	threads[i].postMessage([
		cmd.new_work,
		hpt*i,
		(hpt*(i+1))-1,
		Data[16],
		Data[17],
		Data[18],
		midstate,
		target,
		_ticks + _maxAge
	]);
}

function update_pending(){
	for(let i = 0; i < pc; i++)
		if(threads[i].idle){
			threads[i].idle = false;
			update_data(i);
		}
	fresh_data = 0;
}

function InvokeMethod(method, onSuccess, onError, paramString) {
	xhr.open("POST", Url, true, User, Password);
	xhr.setRequestHeader("Content-type", "application/json-rpc");
	var xMiningExtensions = "";
	if (_averageSpeed > 0) {
		xhr.setRequestHeader("X-Mining-Hashrate", _averageSpeed.toString());
		xMiningExtensions += "noncerange";
	}
	if (xMiningExtensions !== "")
		xhr.setRequestHeader("X-Mining-Extensions", xMiningExtensions);
	xhr.onreadystatechange = function () {
		if (xhr.readyState === XMLHttpRequest.DONE) {
			if (xhr.status === 200) {
				if(debug)console.log(xhr.response);
				onSuccess();
			} else {
				console.error("XMLHttpRequest : " + xhr.status + " " + xhr.statusText);
				console.log("Retrying after " + retryTime + " ms");
				setTimeout(onError, retryTime);
			}
		}
	};
	xhr.send("{\"id\": 0, \"method\": \"" + method + "\", \"params\": [" + ((paramString !== void 0) ? ("\"" + paramString + "\"") : "") + "]}");
}

var getting_work = false;
var getwork_timeout;
var requestStart;
var averageRequestTime = 0;
function GetWork(callback) {
	if(getting_work)return;
	else getting_work = true;
	requestStart = Date.now();
	clearTimeout(getwork_timeout);
	getwork_timeout = setTimeout(GetWork,_maxAge - averageRequestTime);
	console.log("Requesting Work from Pool...");
	InvokeMethod("getwork", function () {
		var data = JSON.parse(xhr.response);
		Data = Utils.stringToInts(Utils.EndianFlip32BitChunks(Utils.RemovePadding(data.data))).slice(0,20);
		sha256d_init(Data);
		target = Utils.stringToInts(Utils.EndianFlip32BitChunks(data.target));
		getting_work = false;
		fresh_data = pc;
		_ticks = Date.now();
		averageRequestTime = (averageRequestTime + _ticks - requestStart) >> 1;
		if(callback)update_pending();
	}, GetWork);
}

function SendShare(_nonce) {
	console.log("Sending Share to Pool...");
	InvokeMethod("getwork", function () {
		if (JSON.parse(xhr.response).result === true)
			console.log("Server accepted the Share!");
		else
			console.error("Server declined the Share!");//значит,в алгоритме серьёзная ошибка...

	}, SendShare, Utils.AddPadding(Utils.EndianFlip32BitChunks(Utils.intsToString(/*Current*/Data)+Utils.intToString(_nonce))));
}

init();
console.log("Server URL: " + Url);
console.log("User: " + User);
console.log("Password: " + Password);
GetWork(true);