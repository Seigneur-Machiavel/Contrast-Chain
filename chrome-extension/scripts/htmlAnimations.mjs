export class WelcomeAnimationBlob {
    constructor(canvasElement, width, height, colorText) {
        this.colorText = colorText;
        this.canvas = canvasElement;
        this.setCanvasSize(width, height);
        this.ctx = canvasElement.getContext('2d');
        this.ob = [];

        this.dotAppearTimings = [5000, 2000, 1000, 200, 200, 200, 200, 200, 200, 200];
        this.rndMaxDelay = 2000;
        this.paused = false;
    }
    setCanvasSize(width, height) {
        this.canvas.width = width;
        this.canvas.height = height;
    }
    newBlob(amount = 1) {
        let a,b,c,d;
        let tx = this.canvas.width/2;
        let ty = this.canvas.height/2;
    
        for(a=0;a<amount;a++){
            b={};
            c=Math.PI*2*Math.random();
            d=Math.random()*1000;
            b.x=tx+Math.cos(c)*d;
            b.y=ty+Math.sin(c)*d;
            b.rx=b.ry=0;
            b.typ=(Math.random()*360)|0;
            this.ob.push(b);
        }
    }
    start() {
        this.initBlobAppearSequence();
        requestAnimationFrame(() => this.frameAction());
    }
    async initBlobAppearSequence() {
        for (let i = 0; i < 50; i++) {
            if (this.paused) {
                await new Promise(resolve => setTimeout(resolve, 20));
                i--;
                continue;
            }

            this.newBlob(1);

            const rndDelay = Math.random() * this.rndMaxDelay;
            const delay = this.dotAppearTimings[i] || rndDelay;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    async frameAction() {
        while (this.paused) {
            await new Promise(resolve => setTimeout(resolve, 20));
        }

        const colorText = this.colorText;
        const ob = this.ob;
        const tx=this.canvas.width/2;
        const ty=this.canvas.height/2;

        let count=0;
        let a,b,c,d,e,f,g,h,x,y,abs,pe,tim;
        const ctx = this.ctx;
        ctx.globalCompositeOperation = "source-over";
    
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
        tim=count/270;
        abs=Math.abs;
        pe=1.2+Math.sin(tim/14.7)*0.87;
        
        for(a=0;a<ob.length;a++){
            b=ob[a];
            b.rx*=0.2;
            b.ry*=0.2;
            b.s=0.72+Math.sin((b.typ/360)*Math.PI*2+tim)/2;
            b.s*=b.s;
        }
        for(a=0;a<ob.length;a++){
            b=ob[a];
            for(c=a+1;c<ob.length;c++){
                d=ob[c];
                x=b.x-d.x;
                y=b.y-d.y;
                e=(b.typ-d.typ)/360;
                if(e<0)e+=1;
                if(e>0.52)e=1-e;
                e*=pe;
                if(e>1)continue;
                e=0.2+e*1.2;
                h=120*e*(b.s+d.s+0.4)/pe;
                if(abs(x)>h || abs(y)>h)continue;
                e=Math.pow(x*x+y*y,0.68);
                if(e<h){
                    e=(h-e)/h;
                    e*=e/10;
                    x*=e;
                    y*=e;
                    b.rx+=x;
                    b.ry+=y;
                    d.rx-=x;
                    d.ry-=y;
                }
            }
        }
        for(a=0;a<ob.length;a++){
            b=ob[a];
            x=b.x-tx;
            y=b.y-ty;
            e=Math.pow(x*x+y*y,0.5);
            b.rx-=x*e/2000; // 2750
            b.ry-=y*e/2000; // 2750
            b.x+=b.rx;
            b.y+=b.ry;
        }
        for(a=0;a<ob.length;a++){
            b=ob[a];
            ctx.strokeStyle=ctx.fillStyle=colorText;
            ctx.beginPath();
            ctx.arc(b.x,b.y,10*(b.s+0.8),0,Math.PI*2,0);
            ctx.fill();
            ctx.stroke();
        }
        count++;
        requestAnimationFrame(() => this.frameAction());
    }
}

export const horizontalBtnLoading = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid" width="200" height="200" style="shape-rendering: auto;display: block;width: 100%;height:200%;transform: translate(0, -25%);"><g><circle fill="#c4c4c4" r="10" cy="50" cx="84"><animate begin="0s" keySplines="0 0.5 0.5 1" values="10;0" keyTimes="0;1" calcMode="spline" dur="0.25s" repeatCount="indefinite" attributeName="r"/><animate begin="0s" values="#c4c4c4;#424242;#6e6e6e;#959595;#c4c4c4" keyTimes="0;0.25;0.5;0.75;1" calcMode="discrete" dur="1s" repeatCount="indefinite" attributeName="fill"/></circle><circle fill="#c4c4c4" r="10" cy="50" cx="16"><animate begin="0s" keySplines="0 0.5 0.5 1;0 0.5 0.5 1;0 0.5 0.5 1;0 0.5 0.5 1" values="0;0;10;10;10" keyTimes="0;0.25;0.5;0.75;1" calcMode="spline" dur="1s" repeatCount="indefinite" attributeName="r"/><animate begin="0s" keySplines="0 0.5 0.5 1;0 0.5 0.5 1;0 0.5 0.5 1;0 0.5 0.5 1" values="16;16;16;50;84" keyTimes="0;0.25;0.5;0.75;1" calcMode="spline" dur="1s" repeatCount="indefinite" attributeName="cx"/></circle><circle fill="#959595" r="10" cy="50" cx="50"><animate begin="-0.25s" keySplines="0 0.5 0.5 1;0 0.5 0.5 1;0 0.5 0.5 1;0 0.5 0.5 1" values="0;0;10;10;10" keyTimes="0;0.25;0.5;0.75;1" calcMode="spline" dur="1s" repeatCount="indefinite" attributeName="r"/><animate begin="-0.25s" keySplines="0 0.5 0.5 1;0 0.5 0.5 1;0 0.5 0.5 1;0 0.5 0.5 1" values="16;16;16;50;84" keyTimes="0;0.25;0.5;0.75;1" calcMode="spline" dur="1s" repeatCount="indefinite" attributeName="cx"/></circle><circle fill="#6e6e6e" r="10" cy="50" cx="84"><animate begin="-0.5s" keySplines="0 0.5 0.5 1;0 0.5 0.5 1;0 0.5 0.5 1;0 0.5 0.5 1" values="0;0;10;10;10" keyTimes="0;0.25;0.5;0.75;1" calcMode="spline" dur="1s" repeatCount="indefinite" attributeName="r"/><animate begin="-0.5s" keySplines="0 0.5 0.5 1;0 0.5 0.5 1;0 0.5 0.5 1;0 0.5 0.5 1" values="16;16;16;50;84" keyTimes="0;0.25;0.5;0.75;1" calcMode="spline" dur="1s" repeatCount="indefinite" attributeName="cx"/></circle><circle fill="#424242" r="10" cy="50" cx="16"><animate begin="-0.75s" keySplines="0 0.5 0.5 1;0 0.5 0.5 1;0 0.5 0.5 1;0 0.5 0.5 1" values="0;0;10;10;10" keyTimes="0;0.25;0.5;0.75;1" calcMode="spline" dur="1s" repeatCount="indefinite" attributeName="r"/><animate begin="-0.75s" keySplines="0 0.5 0.5 1;0 0.5 0.5 1;0 0.5 0.5 1;0 0.5 0.5 1" values="16;16;16;50;84" keyTimes="0;0.25;0.5;0.75;1" calcMode="spline" dur="1s" repeatCount="indefinite" attributeName="cx"/></circle><g/></g><!-- [ldio] generated by https://loading.io --></svg>';