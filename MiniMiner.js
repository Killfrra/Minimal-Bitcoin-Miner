var debug = true;
var Utils = {       
	encoder : new TextEncoder("utf-8"),
	stringToBytes:function(input)
	{
		return this.encoder.encode(input);
	},

        bytesToString:function(input)
        {
            var result = "";
            for(let i = 0; i < input.length; i++)
                result += input[i].toString(16);

            return result;
        },

	uintToBytes:function (value){
		return new Uint8Array([(value & 0xff000000) >> 24,(value & 0x00ff0000) >> 16,(value & 0x0000ff00) >> 8,value & 0x000000ff]);
	},

        uintToString:function (value)
        {
	    var tmp = this.uintToBytes(value);
            return (tmp[0].toString(16) + tmp[1].toString(16) + tmp[2].toString(16) + tmp[3].toString(16));
        },

        EndianFlip32BitChunks:function (input)
        {
            //32 bits = 4 bytes = 8 chars?
            var result = "";
            for (let i = 0; i < input.length; i += 8)
                for (let j = 0; j < 8; j += 2)
                {
                    //append byte (2 chars)
                    result += input[i - j + 6];
                    result += input[i - j + 7];
                }
            return result;
        },

        RemovePadding:function (input)
        {
            //payload length: final 64 bits in big-endian - 0x0000000000000280 = 640 bits = 80 bytes = 160 chars
            return input.substr(0, 160);
        },

        AddPadding:function (input)
        {
            //add the padding to the payload. It never changes.
            return input + "000000800000000000000000000000000000000000000000000000000000000000000000000000000000000080020000";
        }
    };

var _nonce = 0;

function Work(data)
        {
            this.Data = data;
            this.Current = data;
            var _ticks = Date.now(),
	    _hasher = new Hash(),
	    tmp;


        this.FindShare = function(/*ref nonce,*/ batchSize)
        {
            for(;batchSize > 0; batchSize--)
            {
		tmp = Utils.uintToBytes(_nonce);
		for(let i = 4,j = 0;j < 4;i--,j++)this.Current[this.Data.length - i] = tmp[j];

                var doubleHash = Sha256(Sha256(this.Current));

                //count trailing bytes that are zero
                var zeroBytes = 0;
                for (let i = 31; i >= 28; i--, zeroBytes++)
                    if(doubleHash[i] > 0)
                        break;

                //standard share difficulty matched! (target:ffffffffffffffffffffffffffffffffffffffffffffffffffffffff00000000)
                if(zeroBytes == 4)
                    return true;

                //increase
                if(++_nonce == 4294967295)
                    _nonce = 0;
            }
            return false;
        };

        function Sha256(input)
        {
           _hasher.update(input);
    	   var digest = _hasher.digest();
           _hasher.clean();
           return digest;
        }

        this.get_Hash = function()
        {
            return Sha256(Sha256(this.Current));
        };

        this.get_Age = function() 
        {
            return Date.now() - _ticks;
        };
    }


function Pool(login)
        {
            var urlStart = login.indexOf('@'),
            passwordStart = login.indexOf(':');
            this.Url = "http://"+login.substr(urlStart + 1);
            this.User = login.substr(0, passwordStart);
            this.Password = login.substr(passwordStart + 1, urlStart - passwordStart - 1);

        function InvokeMethod(obj,method,paramString)
        {
	    if(debug)return '{"data":"0000000109a78d37203813d08b45854d51470fcdb588d6dfabbe946e92ad207e0000000038a8ae02f7471575aa120d0c85a10c886a1398ad821fadf5124c37200cb677854e0603871d07fff800000000000000800000000000000000000000000000000000000000000000000000000000000000000000000000000080020000"}';
            var webRequest = new XMLHttpRequest();
	    webRequest.open("POST",obj.Url,false,obj.User, obj.Password);
            webRequest.setRequestHeader("Content-type","application/json-rpc");

            webRequest.send("{\"id\": 0, \"method\": \"" + method + "\", \"params\": [" + ((paramString !== void 0) ? ("\"" + paramString + "\"") : "") + "]}");

            return webRequest.response;
        }
        
        this.GetWork = function(silent)
        {
	    if(silent === void 0)silent = false;
            return new Work(ParseData(InvokeMethod(this,"getwork")));
        };

        function ParseData(json)
        {
            var match = json.match("\"data\"\s*:\s*\"([A-Fa-f0-9]+)");
            if (match !== null)
            {
                var data = Utils.RemovePadding(match[1]);
                data = Utils.EndianFlip32BitChunks(data);
                return Utils.stringToBytes(data);
            }
            throw new Error("Didn't find valid 'data' in Server Response");
        }

        this.SendShare = function(share)
        {
            var data = Utils.EndianFlip32BitChunks(Utils.uintToString(share));
            var paddedData = Utils.AddPadding(data);
            var jsonReply = InvokeMethod(this,"getwork", paddedData);
            var match = jsonReply.match("\"result\": true");
            return (match !== null);
        };
    }

        var _pool,_work;
        var _maxAge = 20000;//ms
        var _batchSize = 100000;

        function Main(args)
        {
                    _pool = SelectPool();
                    _work = GetWork();
                    while (true)
                    {
                        if (_work === null || _work.get_Age() > _maxAge)
                            _work = GetWork();

                        if (_work.FindShare(/*ref _nonce,*/ _batchSize))
                        {
                            SendShare(_work.Current);
                            _work = null;
                        }
                        else
                            PrintCurrentState();
                    }
        }

        function SelectPool()
        {
            console.log("Chose a Mining Pool 'user:password@url:port' or leave empty to skip.");
            console.log("Select Pool: ");
            var login = ReadLineDefault("1BhKdW7omrkQrWa3VtS8PwtDuMDCK2uRu1:ANYTHING@mine.p2pool.com:9332");
            return new Pool(login);
        }

        function GetWork()
        {
            console.log("Requesting Work from Pool...");
            console.log("Server URL: " + _pool.Url);
            console.log("User: " + _pool.User);
            console.log("Password: " + _pool.Password);
            return _pool.GetWork();
        }

        function SendShare(share)
        {
            console.log("*** Found Valid Share ***");
            console.log("Share: " + Utils.bytesToString(_work.Current));
            console.log("Nonce: " + Utils.uintToString(_nonce));
            console.log("Hash: " + Utils.bytesToString(_work.get_Hash()));
            console.log("Sending Share to Pool...");
            if (_pool.SendShare(share))
                console.log("Server accepted the Share!");
            else
                console.log("Server declined the Share!");

            console.log("Hit 'Enter' to continue...");
            console.log("*Enter*");
        }

        var _lastPrint = Date.now();
        function PrintCurrentState()
        {
            console.log("Data: " + Utils.bytesToString(_work.Data));
            var current = Utils.uintToString(_nonce);
            var max = Utils.uintToString(4294967295);
            var progress = (_nonce / 4294967295) * 100;
            console.log("Nonce: " + current + "/" + max + " " + progress/*TODO:.ToString("F2")*/ + "%");
            console.log("Hash: " + Utils.bytesToString(_work.get_Hash()));
            var span = Date.now() - _lastPrint;
            console.log("Speed: " + Math.floor((_batchSize / 1000) / (span/1000/*seconds*/)) + "Kh/s"); 
            _lastPrint = Date.now();
        }

        function ReadLineDefault(defaultValue)
        {
            //Allow Console.ReadLine with a default value
            var userInput = "";
            if (userInput === ""){
		console.log(defaultValue);
                return defaultValue;
            }else
                return userInput;
        }

	Main();
