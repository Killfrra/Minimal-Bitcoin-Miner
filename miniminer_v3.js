/* jshint bitwise : false */
/* jshint esversion : 6 */
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

var Data ,target, _ticks = 0,share;

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
var _nonce = 0;
var workid = 0;
var sending_share = false;
var getting_work = false;

var cmd = {
	new_work : 0,
	send_share : 1,
	finished : 2,
	update : 3
};
var cmd2str = ["new_work","send_share","finished","update"];
var threads = new Array(1);
var hpt = 4294967296 / threads.length;//hashes per thread
GetWork(function(){ //всё начинается здесь
	for(let i = 0;i < threads.length; i++){
		threads[i] = new Worker('worker.js');
		threads[i].onmessage = function(arg){	//по возвращении worker доложится о цели своего прибытия
			console.log(cmd2str[arg.data[0]],arg.data.slice(1));
			if(arg.data[0] == cmd.send_share){	//если worker хочет отправить share
				this.idle = true;	//он простаивает до тех пор,пока не придёт ответ с pool'а. Экономия ресурсов в надежде на положительный ответ
				if(sending_share === false){//если никто ещё не озадачен этим
					//то что будет отправлено. Помещается в переменную,что бы не генерировать снова в случае сбоя отправки
					share = Utils.AddPadding(Utils.EndianFlip32BitChunks(Utils.intsToString(Data)+Utils.intToString(_nonce)));
					SendShare(arg.data[1]);
					sending_share = true;	//говорит остальным простаивать по возращении
				}
			}else if(arg.data[0] == cmd.finished || (Date.now() - _ticks) >= _maxAge){//если worker проверил всё,что ему было велено,и ничего не нашёл (о чём и сообщил) или не успел
				if(debug)console.log("Work outdated.Passed "+(Date.now() - _ticks)+" ms");
				this.idle = true;	//он простаивает
				if(getting_work === false){//если никто ещё не озадачен этим
					GetWork(update_pending);//до тех пор,пока не прийдёт запрошенная в этой строке новая работа
					getting_work = true;	//все простаивают
				}
			}else if(arg.data[0] == cmd.update){	//если worker спрашивает : "нет ли более новой работы?"
				this.idle = false;	//раз срок действия работы не истёк (раз мы сюда дошли),скучать ему не придётся
				if(this.workid != workid)this.update_work();	//если работа сменилась за время отсутствия,то так и сообщаем
				else this.postMessage([-1]);			//иначе пусть работать продолжает
				//console.log("Nonce: " + Utils.intToString(arg.data[1]) + "/ffffffff " + ((_nonce / 4294967295) * 100).toFixed(2) + "%");
				var speed = Math.floor((_batchSize * 1000) / (Date.now() - _lastPrint)); /*=_batchSize div ((now - _lastPrint) div 1000)*/
				_averageSpeed = (_averageSpeed + speed) >> 1; //div 2
				console.log("Speed of worker number "+i+" = " + (speed / 1000) + " Kh/s");
				_lastPrint = Date.now();
			}
		};
		(threads[i].update_work = function(){
			console.log(cmd.new_work,hpt*i,(hpt*(i+1))-1,Data[16],Data[17],Data[18],midstate,target);
			threads[i].postMessage([
				cmd.new_work,
				hpt*i,
				(hpt*(i+1))-1,
				Data[16],
				Data[17],
				Data[18],
				midstate,
				target
			]);
			threads[i].idle = false;
			threads[i].workid = workid;
		})();
	}
});

function update_pending(){
	GetWork(function(){
		for(let i = 0; i < threads.length; i++)if(threads[i].idle)threads[i].update_work();
	});
}

function terminate(){threads[0].terminate();clearTimeout(getwork_timeout);}

var getwork_timeout,prev_data = "";

function GetWork(callback) {
	clearTimeout(getwork_timeout);
	console.log("Requesting Work from Pool...");
	if (debug) {
		console.log("Server URL: " + Url);
		console.log("User: " + User);
		console.log("Password: " + Password);
	}
	InvokeMethod("getwork", function () {
		data = JSON.parse(xhr.response);
		if(data.data != prev_data){
			console.log(data.data);
			console.log(prev_data);
			Data = Utils.stringToInts(Utils.EndianFlip32BitChunks(Utils.RemovePadding(data.data))).slice(0,20);
			sha256d_init(Data);
			target = Utils.stringToInts(Utils.EndianFlip32BitChunks(data.target));
			workid++;
		}
		_ticks = Date.now();
		getting_work = false;
		if(callback !== undefined)callback();
		getwork_timeout = setTimeout(GetWork,_maxAge);
		prev_data = data.data;
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

function SendShare(_nonce,onerror) {
	console.log("Sending Share to Pool...");
	InvokeMethod("getwork", function () {
		if (JSON.parse(xhr.response).result === true){
			console.log("Server accepted the Share!");
			sending_share = false;
			update_pending();
		}else{
			console.error("Server declined the Share!");
			onerror();//шукаємо далі
		}
		
	}, SendShare, share);
}
