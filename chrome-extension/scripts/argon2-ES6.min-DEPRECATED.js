let argon2Module=(()=>{var A,I,g={773(A,I,g){var B,Q="undefined"!=typeof self&&void 0!==self.Module?self.Module:{},C={};for(B in Q)Q.hasOwnProperty(B)&&(C[B]=Q[B]);var E,i,o,D,n=[];E="object"==typeof window,i="function"==typeof importScripts,o="object"==typeof process&&"object"==typeof process.versions&&"string"==typeof process.versions.node,D=!E&&!o&&!i;var a,F,e,y,t,w="";o?(w=i?g(967).dirname(w)+"/":"//",a=function(A,I){return y||(y=g(145)),t||(t=g(967)),A=t.normalize(A),y.readFileSync(A,I?null:"utf8")},e=function(A){var I=a(A,!0);return I.buffer||(I=new Uint8Array(I)),N(I.buffer),I},process.argv.length>1&&process.argv[1].replace(/\\/g,"/"),n=process.argv.slice(2),A.exports=Q,process.on("uncaughtException",function(A){if(!(A instanceof V))throw A}),process.on("unhandledRejection",d),Q.inspect=function(){return"[Emscripten Module object]"}):D?("undefined"!=typeof read&&(a=function(A){return read(A)}),e=function(A){var I;return"function"==typeof readbuffer?new Uint8Array(readbuffer(A)):(N("object"==typeof(I=read(A,"binary"))),I)},"undefined"!=typeof scriptArgs?n=scriptArgs:void 0!==arguments&&(n=arguments),"undefined"!=typeof print&&("undefined"==typeof console&&(console={}),console.log=print,console.warn=console.error="undefined"!=typeof printErr?printErr:print)):(E||i)&&(i?w=self.location.href:"undefined"!=typeof document&&document.currentScript&&(w=document.currentScript.src),w=0!==w.indexOf("blob:")?w.substr(0,w.lastIndexOf("/")+1):"",a=function(A){var I=new XMLHttpRequest;return I.open("GET",A,!1),I.send(null),I.responseText},i&&(e=function(A){var I=new XMLHttpRequest;return I.open("GET",A,!1),I.responseType="arraybuffer",I.send(null),new Uint8Array(I.response)}),F=function(A,I,g){var B=new XMLHttpRequest;B.open("GET",A,!0),B.responseType="arraybuffer",B.onload=function(){200==B.status||0==B.status&&B.response?I(B.response):g()},B.onerror=g,B.send(null)}),Q.print||console.log.bind(console);var G,s,h=Q.printErr||console.warn.bind(console);for(B in C)C.hasOwnProperty(B)&&(Q[B]=C[B]);C=null,Q.arguments&&(n=Q.arguments),Q.thisProgram&&Q.thisProgram,Q.quit&&Q.quit,Q.wasmBinary&&(G=Q.wasmBinary),Q.noExitRuntime,"object"!=typeof WebAssembly&&d("no native wasm support detected");var r=!1;function N(A,I){A||d("Assertion failed: "+I)}var c,$,R="undefined"!=typeof TextDecoder?new TextDecoder("utf8"):void 0;function U(A){c=A,Q.HEAP8=new Int8Array(A),Q.HEAP16=new Int16Array(A),Q.HEAP32=new Int32Array(A),Q.HEAPU8=$=new Uint8Array(A),Q.HEAPU16=new Uint16Array(A),Q.HEAPU32=new Uint32Array(A),Q.HEAPF32=new Float32Array(A),Q.HEAPF64=new Float64Array(A)}Q.INITIAL_MEMORY;var Y,M=[],f=[],S=[],H=0,k=null,J=null;function d(A){throw Q.onAbort&&Q.onAbort(A),h(A+=""),r=!0,A="abort("+A+"). Build with -s ASSERTIONS=1 for more info.",new WebAssembly.RuntimeError(A)}function u(A){return A.startsWith("data:application/octet-stream;base64,")}function L(A){return A.startsWith("file://")}Q.preloadedImages={},Q.preloadedAudios={};var p,K="argon2.wasm";function l(A){try{if(A==K&&G)return new Uint8Array(G);if(e)return e(A);throw"both async and sync fetching of the wasm failed"}catch(I){d(I)}}function q(A){for(;A.length>0;){var I=A.shift();if("function"!=typeof I){var g=I.func;"number"==typeof g?void 0===I.arg?Y.get(g)():Y.get(g)(I.arg):g(void 0===I.arg?null:I.arg)}else I(Q)}}function x(A){try{return s.grow(A-c.byteLength+65535>>>16),U(s.buffer),1}catch(I){}}u(K)||(p=K,K=Q.locateFile?Q.locateFile(p,w):w+p);var b,m={a:function(A,I,g){$.copyWithin(A,I,I+g)},b:function(A){var I,g=$.length;if((A>>>=0)>2147418112)return!1;for(var B=1;B<=4;B*=2){var Q=g*(1+.2/B);if(Q=Math.min(Q,A+100663296),x(Math.min(2147418112,((I=Math.max(A,Q))%65536>0&&(I+=65536-I%65536),I))))return!0}return!1}},X=(function(){var A={a:m};function I(A,I){var g,B=A.exports;Q.asm=B,U((s=Q.asm.c).buffer),Y=Q.asm.k,g=Q.asm.d,f.unshift(g),function(A){if(H--,Q.monitorRunDependencies&&Q.monitorRunDependencies(H),0==H&&(null!==k&&(clearInterval(k),k=null),J)){var I=J;J=null,I()}}()}function g(A){I(A.instance)}function B(I){return(function(){if(!G&&(E||i)){if("function"==typeof fetch&&!L(K))return fetch(K,{credentials:"same-origin"}).then(function(A){if(!A.ok)throw"failed to load wasm binary file at '"+K+"'";return A.arrayBuffer()}).catch(function(){return l(K)});if(F)return new Promise(function(A,I){F(K,function(I){A(new Uint8Array(I))},I)})}return Promise.resolve().then(function(){return l(K)})})().then(function(I){return WebAssembly.instantiate(I,A)}).then(I,function(A){h("failed to asynchronously prepare wasm: "+A),d(A)})}if(H++,Q.monitorRunDependencies&&Q.monitorRunDependencies(H),Q.instantiateWasm)try{return Q.instantiateWasm(A,I)}catch(C){return h("Module.instantiateWasm callback failed with error: "+C),!1}G||"function"!=typeof WebAssembly.instantiateStreaming||u(K)||L(K)||"function"!=typeof fetch?B(g):fetch(K,{credentials:"same-origin"}).then(function(I){return WebAssembly.instantiateStreaming(I,A).then(g,function(A){return h("wasm streaming compile failed: "+A),h("falling back to ArrayBuffer instantiation"),B(g)})})}(),Q.___wasm_call_ctors=function(){return(Q.___wasm_call_ctors=Q.asm.d).apply(null,arguments)},Q._argon2_hash=function(){return(Q._argon2_hash=Q.asm.e).apply(null,arguments)},Q._malloc=function(){return(X=Q._malloc=Q.asm.f).apply(null,arguments)}),W=(Q._free=function(){return(Q._free=Q.asm.g).apply(null,arguments)},Q._argon2_verify=function(){return(Q._argon2_verify=Q.asm.h).apply(null,arguments)},Q._argon2_error_message=function(){return(Q._argon2_error_message=Q.asm.i).apply(null,arguments)},Q._argon2_encodedlen=function(){return(Q._argon2_encodedlen=Q.asm.j).apply(null,arguments)},Q._argon2_hash_ext=function(){return(Q._argon2_hash_ext=Q.asm.l).apply(null,arguments)},Q._argon2_verify_ext=function(){return(Q._argon2_verify_ext=Q.asm.m).apply(null,arguments)},Q.stackAlloc=function(){return(W=Q.stackAlloc=Q.asm.n).apply(null,arguments)});function V(A){this.name="ExitStatus",this.message="Program terminated with exit("+A+")",this.status=A}function T(A){function I(){b||(b=!0,Q.calledRun=!0,r||(q(f),Q.onRuntimeInitialized&&Q.onRuntimeInitialized(),function(){var A;if(Q.postRun)for("function"==typeof Q.postRun&&(Q.postRun=[Q.postRun]);Q.postRun.length;)A=Q.postRun.shift(),S.unshift(A);q(S)}()))}A=A||n,H>0||(function(){var A;if(Q.preRun)for("function"==typeof Q.preRun&&(Q.preRun=[Q.preRun]);Q.preRun.length;)A=Q.preRun.shift(),M.unshift(A);q(M)}(),H>0||(Q.setStatus?(Q.setStatus("Running..."),setTimeout(function(){setTimeout(function(){Q.setStatus("")},1),I()},1)):I()))}if(Q.allocate=function(A,I){var g;return g=1==I?W(A.length):X(A.length),A.subarray||A.slice?$.set(A,g):$.set(new Uint8Array(A),g),g},Q.UTF8ToString=function(A,I){return A?function(A,I,g){for(var B=I+g,Q=I;A[Q]&&!(Q>=B);)++Q;if(Q-I>16&&A.subarray&&R)return R.decode(A.subarray(I,Q));for(var C="";I<Q;){var E=A[I++];if(128&E){var i=63&A[I++];if(192!=(224&E)){var o=63&A[I++];if((E=224==(240&E)?(15&E)<<12|i<<6|o:(7&E)<<18|i<<12|o<<6|63&A[I++])<65536)C+=String.fromCharCode(E);else{var D=E-65536;C+=String.fromCharCode(55296|D>>10,56320|1023&D)}}else C+=String.fromCharCode((31&E)<<6|i)}else C+=String.fromCharCode(E)}return C}($,A,I):""},Q.ALLOC_NORMAL=0,J=function A(){b||T(),b||(J=A)},Q.run=T,Q.preInit)for("function"==typeof Q.preInit&&(Q.preInit=[Q.preInit]);Q.preInit.length>0;)Q.preInit.pop()();T(),A.exports=Q,Q.unloadRuntime=function(){"undefined"!=typeof self&&delete self.Module,Q=s=Y=c=$=void 0,delete A.exports}},631:function(A,I,g){var B,Q;"undefined"!=typeof self&&self,void 0===(Q="function"==typeof(B=function(){let A="undefined"!=typeof self?self:this,I={Argon2d:0,Argon2i:1,Argon2id:2};function B(I){if(B._promise)return B._promise;if(B._module)return Promise.resolve(B._module);let C;return C=A.process&&A.process.versions&&A.process.versions.node?Q().then(A=>new Promise(I=>{A.postRun=()=>I(A)})):(A.loadArgon2WasmBinary?A.loadArgon2WasmBinary():Promise.resolve(g(721)).then(A=>(function(A){let I=atob(A),g=new Uint8Array(new ArrayBuffer(I.length));for(let B=0;B<I.length;B++)g[B]=I.charCodeAt(B);return g})(A))).then(g=>{var B,C;return B=g,C=I?function(A){let I=32767;return new WebAssembly.Memory({initial:Math.min(Math.max(Math.ceil(1024*A/65536),256)+256,I),maximum:I})}(I):void 0,new Promise(I=>(A.Module={wasmBinary:B,wasmMemory:C,postRun(){I(Module)}},Q()))}),B._promise=C,C.then(A=>(B._module=A,delete B._promise,A))}function Q(){return A.loadArgon2WasmModule?A.loadArgon2WasmModule():Promise.resolve(g(773))}function C(A,I){return A.allocate(I,"i8",A.ALLOC_NORMAL)}function E(A,I){return C(A,new Uint8Array([...I,0]))}function i(A){if("string"!=typeof A)return A;if("function"==typeof TextEncoder)return new TextEncoder().encode(A);if("function"==typeof Buffer)return Buffer.from(A);throw Error("Don't know how to encode UTF8")}return{ArgonType:I,hash:function(A){let g=A.mem||1024;return B(g).then(B=>{let Q=A.time||1,o=A.parallelism||1,D=i(A.pass),n=E(B,D),a=D.length,F=i(A.salt),e=E(B,F),y=F.length,t=A.type||I.Argon2d,w=B.allocate(Array(A.hashLen||24),"i8",B.ALLOC_NORMAL),G=A.secret?C(B,A.secret):0,s=A.secret?A.secret.byteLength:0,h=A.ad?C(B,A.ad):0,r=A.ad?A.ad.byteLength:0,N=A.hashLen||24,c=B._argon2_encodedlen(Q,g,o,y,N,t),$=B.allocate(Array(c+1),"i8",B.ALLOC_NORMAL),R,U,Y;try{U=B._argon2_hash_ext(Q,g,o,n,a,e,y,w,N,$,c,t,G,s,h,r,19)}catch(M){R=M}if(0!==U||R){try{R||(R=B.UTF8ToString(B._argon2_error_message(U)))}catch(f){}Y={message:R,code:U}}else{let S="",H=new Uint8Array(N);for(let k=0;k<N;k++){let J=B.HEAP8[w+k];H[k]=J,S+=("0"+(255&J).toString(16)).slice(-2)}Y={hash:H,hashHex:S,encoded:B.UTF8ToString($)}}try{B._free(n),B._free(e),B._free(w),B._free($),h&&B._free(h),G&&B._free(G)}catch(d){}if(R)throw Y;return Y})},verify:function(A){return B().then(g=>{let B=i(A.pass),Q=E(g,B),o=B.length,D=A.secret?C(g,A.secret):0,n=A.secret?A.secret.byteLength:0,a=A.ad?C(g,A.ad):0,F=A.ad?A.ad.byteLength:0,e=E(g,i(A.encoded)),y,t,w,G=A.type;if(void 0===G){let s=A.encoded.split("$")[1];s&&(G=I[s=s.replace("a","A")]||I.Argon2d)}try{t=g._argon2_verify_ext(e,Q,o,D,n,a,F,G)}catch(h){y=h}if(t||y){try{y||(y=g.UTF8ToString(g._argon2_error_message(t)))}catch(r){}w={message:y,code:t}}try{g._free(Q),g._free(e)}catch(N){}if(y)throw w;return w})},unloadRuntime:function(){B._module&&(B._module.unloadRuntime(),delete B._promise,delete B._module)}}})?B.apply(I,[]):B)||(A.exports=Q)},721:function(A,I){A.exports="WebAssembly.Instance"},145(){},967(){}},B={};function Q(A){var I=B[A];if(void 0!==I)return I.exports;var C=B[A]={exports:{}};return g[A].call(C.exports,C,C.exports,Q),C.exports}return Q(631)})();export default argon2Module;