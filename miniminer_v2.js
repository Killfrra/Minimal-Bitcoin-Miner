var debug = true;
var Utils = {
	stringToBytes: function (input) {
		var bytes = new Uint8Array(input.length / 2);
		for (let i = 0, j = 0; i < input.length; j++, i += 2)
			bytes[j] = parseInt(input.substr(i, 2), 16);
		return bytes;
	},
	bytesToString: function (input) {
		var result = "";
		for (let i = 0; i < input.length; i++) result += input[i].toString(16);
		return result;
	},
	uintToBytes: function (value) {
		return new Uint8Array([(value & 0xff000000) >> 24, (value & 0x00ff0000) >> 16, (value & 0x0000ff00) >> 8, value & 0x000000ff]);
	},
	uintToString: function (value) {
		var tmp = this.uintToBytes(value);
		return (tmp[0].toString(16) + tmp[1].toString(16) + tmp[2].toString(16) + tmp[3].toString(16));
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
var _nonce = 0;
var _hasher = new Hash();
var Data, Current, _ticks,tmp;

function get_Hash() {
	return Sha256(Sha256(Current));
}
var _averageSpeed = 0; //hs
var login = "1BhKdW7omrkQrWa3VtS8PwtDuMDCK2uRu1:ANYTHING@localhost:80/getwork.php";
var urlStart = login.indexOf('@');
var passwordStart = login.indexOf(':');
var Url = "http://" + login.substr(urlStart + 1);
var User = login.substr(0, passwordStart);
var Password = login.substr(passwordStart + 1, urlStart - passwordStart - 1);
var _maxAge = 20000; //ms
var _batchSize = 1000000;
var xhr = new XMLHttpRequest();
var retryTime = 30000;
var _lastPrint = Date.now();

function Sha256(input) {
	_hasher.update(input);
	var digest = _hasher.digest();
	_hasher.clean();
	return digest;
}

function Main(args) {
	while ((Date.now() - _ticks) <= _maxAge) {
		for (let batchSize = _batchSize; batchSize > 0; batchSize--) {
			tmp = Utils.uintToBytes(_nonce);
			for (let i = 4, j = 0; j < 4; i--, j++) this.Current[this.Data.length - i] = tmp[j];
			var doubleHash = Sha256(Sha256(this.Current));
			//count trailing bytes that are zero
			var zeroBytes = 0;
			for (let i = 31; i >= 28; i--, zeroBytes++)
				if (doubleHash[i] > 0) break;
			//standard share difficulty matched! (target:ffffffffffffffffffffffffffffffffffffffffffffffffffffffff00000000)
			if (zeroBytes == 4) {
				console.log("*** Found Valid Share ***");
				if (debug) {
					console.log("Share: " + Utils.bytesToString(Current));
					console.log("Nonce: " + Utils.uintToString(_nonce));
					console.log("Hash: " + Utils.bytesToString(get_Hash()));
				}
				SendShare();
				return;
			}
			//increase
			if (++_nonce == 4294967295) _nonce = 0;
		}
		console.log("Data: " + Utils.bytesToString(Data));
		console.log("Nonce: " + Utils.uintToString(_nonce) + "/ffffffff " + ((_nonce / 4294967295) * 100).toFixed(2) + "%");
		console.log("Hash: " + Utils.bytesToString(get_Hash()));
		var speed = Math.floor((_batchSize * 1000) / (Date.now() - _lastPrint)); /*=_batchSize div ((now - _lastPrint) div 1000)*/
		_averageSpeed = (_averageSpeed + speed) >> 1; //div 2
		console.log("Speed: " + (speed / 1000) + " Kh/s");
		_lastPrint = Date.now();
	}
	if(debug)console.log("Work outdated.Passed "+(Date.now() - _ticks)+" ms");
	GetWork();
}

function GetWork() {
	console.log("Requesting Work from Pool...");
	if (debug) {
		console.log("Server URL: " + Url);
		console.log("User: " + User);
		console.log("Password: " + Password);
	}
	InvokeMethod("getwork", function () {
		var data = JSON.parse(xhr.response);
		Data = Utils.stringToBytes(Utils.EndianFlip32BitChunks(Utils.RemovePadding(data.data)));
		Current = Data;
		_ticks = Date.now();
		Main();
	}, GetWork);
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

function SendShare() {
	console.log("Sending Share to Pool...");
	InvokeMethod("getwork", function () {
		if (JSON.parse(xhr.response).result === true)
			console.log("Server accepted the Share!");
		else console.error("Server declined the Share!");
		GetWork();
	}, SendShare, Utils.AddPadding(Utils.EndianFlip32BitChunks(Utils.bytesToString(Current))));
}