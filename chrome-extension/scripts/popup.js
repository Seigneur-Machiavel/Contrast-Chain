if (false) { // THIS IS FOR DEV ONLY ( to get better code completion)-
    const anime = require("./anime.min.js");
    const PatternGenerator = require("./pattern-generator.js");
	const { cryptoLight } = require("./cryptoLight.js");
    const { CenterScreenBtn, Communication, AuthInfo, Sanitizer, Miner } = require("./classes.js");
    const { htmlAnimations } = require("./htmlAnimations.js");
    const { Wallet } = require("../contrast/src/wallet.mjs");
    const utils = require("../contrast/src/utils.mjs").default;
    const { Account } = require("../contrast/src/wallet.mjs");
    const { Transaction, Transaction_Builder } = require("../contrast/src/transaction.mjs");
}

/**
* @typedef {import("../contrast/src/transaction.mjs").UTXO} UTXO
* @typedef {import("../contrast/src/transaction.mjs").TransactionWithDetails} TransactionWithDetails
* @typedef {import("../contrast/front/explorerScript.mjs").BlockExplorerWidget} BlockExplorerWidget
*/

/** @type {BlockExplorerWidget} */
let blockExplorerWidget;

const patternGenerator = new PatternGenerator({ width: 48, height: 48, scale: 1 });
class WalletInfo {
    constructor(walletInfo = {}) {
        this.name = walletInfo.name || 'wallet1';
        this.encryptedSeedHex = walletInfo.encryptedSeedHex || '';
    }

    extractVarsObjectToSave() {
        return {
            name: this.name,
            encryptedSeedHex: this.encryptedSeedHex
        };
    }
}
class AddressExhaustiveData {
    /** @param {UTXO[]} UTXOs @param {string[]} addressTxsReferences */
    constructor(UTXOs, addressTxsReferences) {
        this.balances = utils.utxoUtils.extractBalances(UTXOs);
        this.UTXOsByRules = utils.utxoUtils.extractUTXOsByRules(UTXOs);
        /** @type {Object<string, string[]>} */
        this.addressTxsReferences = addressTxsReferences;
    }

    mergeNewUTXOs(UTXOs) {
        const newBalances = utils.utxoUtils.extractBalances(UTXOs);
        for (const key in newBalances) {
            if (this.balances[key]) { this.balances[key] += newBalances[key]; }
            else { this.balances[key] = newBalances[key]; }
        }
       
        const newUTXOsByRules = utils.utxoUtils.extractUTXOsByRules(UTXOs);
        for (const rule in newUTXOsByRules) {
            if (this.UTXOsByRules[rule]) { this.UTXOsByRules[rule].push(...newUTXOsByRules[rule]); }
            else { this.UTXOsByRules[rule] = newUTXOsByRules[rule]; }
        }
    }
    /** @param {string[]} txsReferences */
    mergeNewTxsReferences(newTxsReferences) {
        for (const txReference of newTxsReferences) {
            if (this.addressTxsReferences.includes(txReference)) { continue; }
            this.addressTxsReferences.push(txReference);
        }
    }
    /** @param {AddressExhaustiveData} newData @param {boolean} replaceBalances */
    mergeAddressExhaustiveData(newData, replaceBalances = true) {
        for (const key in newData.balances) {
            if (!replaceBalances) { continue; }
            this.balances[key] = newData.balances[key];
        }

        for (const rule in newData.UTXOsByRules) {
            if (this.UTXOsByRules[rule]) { this.UTXOsByRules[rule].push(...newData.UTXOsByRules[rule]); }
            else { this.UTXOsByRules[rule] = newData.UTXOsByRules[rule]; }
        }

        this.mergeNewTxsReferences(newData.addressTxsReferences);
    }
    highestKnownUTXOsHeight() {
        let highestHeight = 0;
        for (const rule in this.UTXOsByRules) {
            for (const UTXO of this.UTXOsByRules[rule]) {
                const height = UTXO.anchor.split(':')[0];
                if (height > highestHeight) { highestHeight = UTXO.height; }
            }
        }
        return highestHeight;
    }
    highestKnownTxsHeight() {
        return this.addressTxsReferences.length === 0 ? 0 : this.addressTxsReferences[this.addressTxsReferences.length - 1];
    }
}
cryptoLight.useArgon2Worker = true; console.log('Argon2 worker enabled!');
const settings = {
    appVersion: chrome.runtime.getManifest().version,
    minVersionAcceptedWithoutReset: '1.2.0',
    hardcodedPassword: '123456',
    serverUrl: "http://localhost:4340",
    popUpSizes: {
        small: '302px',
        medium: '322px',
        large: '800px'
    }
};
const UX_SETTINGS = {
    shapes: 4
};
let resizePopUpAnimations = [];
const sanitizer = new Sanitizer();
const communication = new Communication(settings.serverUrl);
const centerScreenBtn = new CenterScreenBtn();
centerScreenBtn.state = 'welcome';
centerScreenBtn.init(7);
const miner = new Miner(centerScreenBtn, communication);
const selectedWalletIndex = 0;

const animations = {};
const eHTML = {
    documentVisible: true,
    appTitle: document.getElementById('appTitle'),
    welcomeCanvas: document.getElementById('welcomeCanvas'),
    welcomeCanvas2: document.getElementById('welcomeCanvas2'),
    centerScreenBtnContrainer: document.getElementsByClassName('centerScreenBtnContrainer')[0],
    popUpContent: document.getElementById('popUpContent'),
    popUpContentWrap: document.getElementById('popUpContent').children[0],

    passwordCreationForm: document.getElementById('passwordCreationForm'),
    passwordCreationFormInputPassword: document.getElementById('passwordCreationForm').getElementsByTagName('input')[0],
    passwordCreationFormInputConfirm: document.getElementById('passwordCreationForm').getElementsByTagName('input')[1],

    loginForm: document.getElementById('loginForm'),
    loginFormInput: document.getElementById('loginForm').getElementsByTagName('input')[0],

    createWalletForm: document.getElementById('createWalletForm'),
    privateKeyHexInput: document.getElementById('privateKeyHexInput'),
    randomizeBtn: document.getElementById('randomizeBtn'),
    confirmPrivateKeyBtn: document.getElementById('confirmPrivateKeyBtn'),

    //? mnemonicOverviewForm: document.getElementById('mnemonicOverviewForm'),

    settingsForm: document.getElementById('settingsForm'),
    mining: {
        //form: document.getElementById('miningForm'),
        intensityInput: document.getElementsByName('intensity')[0],
        intensityValueStr: document.getElementById('intensityValueStr'),
        hashRateValueStr: document.getElementById('hashRateValueStr'),
    },

    walletForm: document.getElementById('walletForm'),
    spendableBalanceStr: document.getElementById('spendableBalanceStr'),
    stakedStr: document.getElementById('stakedStr'),
    accountsWrap: document.getElementById('accountsWrap'),
    newAddressBtn: document.getElementById('newAddressBtn'),
    sendBtn: document.getElementById('buttonBarSend'),
    swapBtn: document.getElementById('buttonBarSwap'),
    stakeBtn: document.getElementById('buttonBarStake'),
    specialBtn: document.getElementById('buttonBarSpecial'),

    send: {
        miniForm: document.getElementById('spendMiniForm'),
        foldBtn: document.getElementById('spendMiniForm').getElementsByTagName('button')[0],
        senderAddress: document.getElementById('spendMiniForm').getElementsByClassName('senderAddress')[0],
        amount: document.getElementById('spendMiniForm').getElementsByTagName('input')[0],
        address: document.getElementById('spendMiniForm').getElementsByTagName('input')[1],
        confirmBtn: document.getElementById('spendMiniForm').getElementsByTagName('button')[1]
    },
    stake: {
        miniForm: document.getElementById('stakeMiniForm'),
        foldBtn: document.getElementById('stakeMiniForm').getElementsByTagName('button')[0],
        senderAddress: document.getElementById('stakeMiniForm').getElementsByClassName('senderAddress')[0],
        amount: document.getElementById('stakeMiniForm').getElementsByTagName('input')[0],
        address: document.getElementById('stakeMiniForm').getElementsByTagName('input')[1],
        confirmBtn: document.getElementById('stakeMiniForm').getElementsByTagName('button')[1]
    },

    bottomBar: document.getElementById('bottomBar'),
    explorerBtn: document.getElementById('explorerBtn'),
    walletBtn: document.getElementById('walletBtn'),
    miningBtn: document.getElementById('miningBtn'),
    settingsBtn: document.getElementById('settingsBtn'),

    popUpExplorer: document.getElementById('popUpExplorer'),
    contrastBlocksWidget: document.getElementById('cbe-contrastBlocksWidget'),
    txHistoryAddress: document.getElementById('txHistoryAddress'),
    txHistoryWrap: document.getElementById('txHistoryWrap'),
    txHistoryTable: document.getElementById('txHistoryWrap').getElementsByTagName('table')[0],
};

/** @type {Wallet} */
let activeWallet;
const defaultAddressPrefix = "C";
let activeAddressPrefix = "C";
let activeAccountIndexByPrefix = { "W": 0, "C": 0 };
let currentTextInfo = '';
const busy = [];
/** @type {Object<string, AddressExhaustiveData>} */
const addressesExhaustiveData = {};
//#region - UX FUNCTIONS
const colors = { background: 'white', text: 'black' };
function resizePopUp(applyBLur = true, popUpSize = 'small', duration = 200) {
    const contentDivHeight = eHTML.popUpContent.offsetHeight;
    const contentWrapHeight = eHTML.popUpContentWrap.offsetHeight;
    const contentHeight = Math.max(contentDivHeight, contentWrapHeight);
    const newHeight = contentHeight; // + 29;
    console.log(`New height: ${newHeight}px`);
    resizePopUpAnimations = [];
    
    resizePopUpAnimations[0] = anime({
        targets: 'body',
        width: settings.popUpSizes[popUpSize],
        height: `${newHeight}px`,
        filter: applyBLur ? 'blur(2px)' : 'blur(0px)',
        duration,
        easing: 'easeInOutQuad',
        complete: () => {
            if (!applyBLur) { return; }
            resizePopUpAnimations[1] = anime({
                targets: 'body',
                filter: ['blur(4px) brightness(1.4)', 'blur(0px) brightness(1)'],
                easing: 'easeInOutQuad',
                duration: 400
            });
        }
    });
}

function setVisibleForm(formId, applyBLur = true) {
    //const explorerOpenned = !eHTML.popUpExplorer.classList.contains('hidden');
    miner.paused = true;
    eHTML.bottomBar.classList.remove('hidden');
    eHTML.popUpContent.classList.add('large');
    eHTML.appTitle.classList.add('hidden');

    eHTML.walletBtn.classList.add('active');
    eHTML.miningBtn.classList.add('active');
    eHTML.settingsBtn.classList.add('active');
    eHTML.walletBtn.classList.remove('selected');
    eHTML.miningBtn.classList.remove('selected');
    eHTML.settingsBtn.classList.remove('selected');

    eHTML.popUpExplorer.classList.add('hidden');
    eHTML.explorerBtn.classList.remove('active');
    eHTML.explorerBtn.classList.remove('explorerOpenned');
    //if (explorerOpenned) { eHTML.explorerBtn.classList.add('active'); }
    let popUpSize = 'medium';

    centerScreenBtn.centerScreenBtnWrap.classList.remove('active');
    eHTML.welcomeCanvas.classList.add('hidden');
    eHTML.welcomeCanvas2.classList.add('hidden');
    eHTML.centerScreenBtnContrainer.classList.add('hidden');

    const forms = document.getElementsByTagName('form');
    for (let i = 0; i < forms.length; i++) {
        if (forms[i].id === formId) { forms[i].classList.remove('hidden'); continue; }
        forms[i].classList.add('hidden');
    }

    if (formId === "passwordCreationForm" || formId === "loginForm") {
        //eHTML.centerScreenBtnContrainer.classList.remove('hidden');
        eHTML.welcomeCanvas.classList.remove('hidden');
        eHTML.welcomeCanvas2.classList.remove('hidden');
        eHTML.bottomBar.classList.add('hidden');
        eHTML.appTitle.classList.remove('hidden');
        eHTML.popUpContent.classList.remove('large');
        popUpSize = 'small';
        if (formId === "passwordCreationForm") { eHTML.welcomeCanvas.style.marginBottom = "-156px"; }
    }

    if (formId === "walletForm") {
        eHTML.explorerBtn.classList.add('active');
        eHTML.walletBtn.classList.remove('active');
        eHTML.walletBtn.classList.add('selected');
    }
    if (formId === "createWalletForm") {
        eHTML.miningBtn.classList.remove('active');
        eHTML.settingsBtn.classList.remove('active');
        eHTML.bottomBar.classList.add('hidden');
        eHTML.popUpContent.classList.remove('large');
        popUpSize = 'small';
    }

    if (formId === "miningForm") {
        miner.paused = false;
        eHTML.centerScreenBtnContrainer.classList.remove('hidden');
        centerScreenBtn.centerScreenBtnWrap.classList.add('active');
        eHTML.miningBtn.classList.remove('active');
        eHTML.miningBtn.classList.add('selected');
        setTimeout(async () => {
            const miningIntensity = await chrome.storage.local.get('miningIntensity');
            const intensity = miningIntensity.miningIntensity || 0;
            eHTML.mining.intensityInput.value = intensity;
            //eHTML.mining.intensityValueStr.innerText = intensity;
            eHTML.mining.intensityValueStr.innerText = intensity === 0 ? 'OFF' : 'ON';

            const hashRate = await chrome.storage.local.get('hashRate');
            eHTML.mining.hashRateValueStr.innerText = hashRate.hashRate.toFixed(3) || '0';
        }, 100);
    }

    if (formId === "settingsForm") {
        eHTML.settingsBtn.classList.remove('active');
        eHTML.settingsBtn.classList.add('selected');

        setTimeout(async () => {
            const miningIntensity = await chrome.storage.local.get('miningIntensity');
            const intensity = miningIntensity.miningIntensity || 0;
            eHTML.mining.intensityInput.value = intensity;
            //eHTML.mining.intensityValueStr.innerText = intensity;
            eHTML.mining.intensityValueStr.innerText = intensity === 0 ? 'OFF' : 'ON';

            const hashRate = await chrome.storage.local.get('hashRate');
            eHTML.mining.hashRateValueStr.innerText = hashRate.hashRate.toFixed(3) || '0';
        }, 100);
    }

    resizePopUp(applyBLur, popUpSize);
}
function toggleExplorer() {
    const popUpContentWrapChildren = eHTML.popUpContentWrap.children;
    const activeForm = Array.from(popUpContentWrapChildren).find(form => !form.classList.contains('hidden'));
    console.log(`activeForm: ${activeForm.id}`);

    let popUpSize = 'medium';
    
    if (animations.popUpExplorer) { animations.popUpExplorer.pause(); }
    const explorerOpenned = !eHTML.popUpExplorer.classList.contains('hidden');
    if (explorerOpenned) {
        eHTML.explorerBtn.classList.remove('explorerOpenned');

        eHTML.popUpExplorer.style.opacity = '.6';
        eHTML.popUpExplorer.style.zIndex = '-1';
        animations.popUpExplorer = anime({
            targets: eHTML.popUpExplorer,
            opacity: 0,
            width: settings.popUpSizes[popUpSize],
            duration: 200,
            easing: 'easeInOutQuad',
            complete: () => { eHTML.popUpExplorer.classList.add('hidden'); }
        });
    }
    if (!explorerOpenned) {
        eHTML.popUpExplorer.classList.remove('hidden');
        eHTML.explorerBtn.classList.add('explorerOpenned');
        eHTML.explorerBtn.classList.add('active');
        popUpSize = 'large';
        
        eHTML.popUpExplorer.style.opacity = '0';
        eHTML.popUpExplorer.style.zIndex = '-1';
        eHTML.popUpExplorer.style.width = settings.popUpSizes['medium'];
        const popUpLargeSizeNumber = parseInt(settings.popUpSizes['large'].replace('px', ''));
        const popUpMediumSizeNumber = parseInt(settings.popUpSizes['medium'].replace('px', ''));
        animations.popUpExplorer = anime({
            targets: eHTML.popUpExplorer,
            opacity: 1,
            //width: `calc(800px - ${settings.popUpSizes[popUpSize]})`,
            width: `${popUpLargeSizeNumber - popUpMediumSizeNumber}px`,
            duration: 200,
            easing: 'easeInOutQuad',
            complete: () => { eHTML.popUpExplorer.style.zIndex = '3'; }
        });
    }

    if (activeForm.id === "walletForm") { eHTML.explorerBtn.classList.add('active'); }

    resizePopUp(true, popUpSize);
}
function toggleMiniForm(miniFormElmnt) {
    updateMiniFormsInfoRelatedToActiveAccount();
    const isFold = miniFormElmnt.classList.contains('miniFold');
    if (animations[miniFormElmnt.id]) { animations[miniFormElmnt.id].pause(); }

    // fold : transform: rotateY(60deg) translateX(-160%);
    miniFormElmnt.style.opacity = isFold ? '0' : '1';
    miniFormElmnt.style.filter = isFold ? 'blur(10px)' : 'blur(0px)';
    miniFormElmnt.style.transform = isFold ? 'rotateY(60deg) translateX(-160%)' : 'rotateY(0deg) translateX(0%)';
    if (isFold) {
        animations[miniFormElmnt.id] = anime({
            targets: miniFormElmnt,
            translateX: '0%',
            rotateY: '0deg',
            opacity: 1,
            filter: 'blur(0px)',
            duration: 260,
            easing: 'easeInOutQuad',
            complete: () => { miniFormElmnt.classList.remove('miniFold'); }
        });
    } else {
        animations[miniFormElmnt.id] = anime({
            targets: miniFormElmnt,
            translateX: '-160%',
            rotateY: '60deg',
            opacity: 0,
            filter: 'blur(10px)',
            duration: 260,
            easing: 'easeInOutQuad',
            complete: () => { miniFormElmnt.classList.add('miniFold'); }
        });
    }
}
function setInitialInputValues() {
    const hardcodedPassword = settings.hardcodedPassword;
    eHTML.loginFormInput.value = hardcodedPassword;
    eHTML.passwordCreationFormInputPassword.value = hardcodedPassword;
    eHTML.passwordCreationFormInputConfirm.value = hardcodedPassword;
}
/** Show the form depending on the stored auth info
 * @param {AuthInfo} sanitizedAuthInfo - result of chrome.storage.local.get(['authInfo']).authInfo */
function showFormDependingOnStoredPassword(sanitizedAuthInfo) {
    const { hash, salt1Base64, iv1Base64 } = sanitizedAuthInfo;
    if (hash && salt1Base64 && iv1Base64) {
        setVisibleForm('loginForm');
        eHTML.loginFormInput.focus();
    } else {
        setVisibleForm('passwordCreationForm');
        eHTML.passwordCreationFormInputPassword.focus();
    }
}
function textInfo(targetForm, text, timeout = 3000, eraseAnyCurrentTextInfo = false) {
    const infoElmnts = targetForm.getElementsByClassName('textInfo');
    if (!eraseAnyCurrentTextInfo && currentTextInfo) { return; }

    for (const infoElmnt of infoElmnts) {
        currentTextInfo = text;
        infoElmnt.innerText = text;
        infoElmnt.style.opacity = '1';

        setTimeout(() => {
            currentTextInfo = null;
            infoElmnt.style.opacity = '0';
            setTimeout(() => { infoElmnt.innerText = ""; }, 200);
        }, timeout);
    }
}
function setWaitingForConnectionFormLoading(loading = true) {
    const waitingForConnectionForm = document.getElementById('waitingForConnectionForm');
    const loadingSvg = waitingForConnectionForm.getElementsByClassName('loadingSvgDiv')[0];
    loadingSvg.innerHTML = loading ? htmlAnimations.horizontalBtnLoading : '';
}
async function initUI() {
    document.body.style.width = "0px";
    document.body.style.height = "0px";

    eHTML.welcomeCanvas.width = 360;
    eHTML.welcomeCanvas.height = 400;
    eHTML.welcomeCanvas.style.opacity = '1';
    eHTML.welcomeCanvas.style.filter = 'blur(0px)';

    eHTML.welcomeCanvas2.width = 360;
    eHTML.welcomeCanvas2.height = 400;

    /*const particleAnimation = new ParticleAnimation();
    particleAnimation.particleConfig.sizeRange = [10, 30];
    particleAnimation.init(eHTML.welcomeCanvas);

    const particleAnimation2 = new ParticleAnimation();
    particleAnimation2.particleConfig.radius = 256;
    particleAnimation2.particleConfig.number = 64;
    particleAnimation2.init(eHTML.welcomeCanvas2);*/

    // TITLE APPEAR ANIMATION
    setTimeout(async () => {
        const titleMl3 = eHTML.appTitle.getElementsByClassName('ml3')[0];
        titleMl3.innerHTML = titleMl3.textContent.replace(/\S/g, "<span class='letter' style='display: inline-block'>$&</span>");

        const letterElmnts = titleMl3.getElementsByClassName('letter');
        const nbOfLetters = letterElmnts.length;
        for (let i = 0; i < nbOfLetters; i++) { 
            const rndScale = Math.random() * 2;
            letterElmnts[i].style.transform = `scale(${rndScale})`;
            letterElmnts[i].style.filter = `blur(2px)`;
        }

        const letterAppearedIndexes = [];
        for (let i = 0; i < nbOfLetters; i++) {
            const rnd = Math.floor(Math.random() * nbOfLetters);
            if (letterAppearedIndexes.includes(rnd)) { i--; continue; }

            letterAppearedIndexes.push(rnd);
            anime({
                targets: letterElmnts[rnd],
                opacity: 1,
                scale: 1,
                filter: 'blur(0px)',
                duration: 120,
                easing: 'easeInOutQuad'
            });
            await new Promise(resolve => setTimeout(resolve, 120));
        }
    }, 100);
    
    await new Promise(resolve => setTimeout(resolve, 1000));

    welcomeCanvasAnimationDocStart(eHTML.welcomeCanvas);
    const dotAppearTimings = [5000, 2000, 1000, 200, 200, 200, 200, 200, 200, 200];
    for (let i = 0; i < 50; i++) {
        if (document.visibilityState === 'hidden') {
            await new Promise(resolve => setTimeout(resolve, 20));
            i--;
            continue;
        }
        welcomeCanvasAnimationDocNewBubble(eHTML.welcomeCanvas, 1);

        const rndDelay = Math.random() * 2000;
        const delay = dotAppearTimings[i] || rndDelay;
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    /*const dataURL = eHTML.welcomeCanvas.toDataURL();
    ob = [];
    eHTML.welcomeCanvas.style.backgroundImage = `url(${dataURL})`;
    
    await new Promise(resolve => setTimeout(resolve, 100));
    // set barre img
    eHTML.welcomeCanvas.style.backgroundImage = 'url("../images/contrast128.png")';*/
}
let ob = [];
function welcomeCanvasAnimationDocNewBubble(canvasElement = eHTML.welcomeCanvas, amount = 1) {
    let a,b,c,d;
    let tx = canvasElement.width/2;
    let ty = canvasElement.height/2;

    for(a=0;a<amount;a++){
        b={};
        c=Math.PI*2*Math.random();
        d=Math.random()*1000;
        b.x=tx+Math.cos(c)*d;
        b.y=ty+Math.sin(c)*d;
        b.rx=b.ry=0;
        b.typ=(Math.random()*360)|0;
        ob.push(b);
    }
}
function welcomeCanvasAnimationDocStart(canvasElement = eHTML.welcomeCanvas) {
    let ctx,count,tx,ty;

    ctx = canvasElement.getContext('2d');
    canvasElement.width = 302;
    canvasElement.height = 400;
    count=0;
    tx=canvasElement.width/2;
    ty=canvasElement.height/2;

    async function aaa(){
        /*console.log(`document.visibilityState: ${document.visibilityState}`);
        while (document.visibilityState === 'hidden') {
            await new Promise(resolve => setTimeout(resolve, 20));
            console.log('hidden');
        }*/

        let a,b,c,d,e,f,g,h,x,y,abs,pe,tim;
        ctx.globalCompositeOperation = "source-over";

        ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);

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
            ctx.strokeStyle=ctx.fillStyle=colors.text;
            ctx.beginPath();
            ctx.arc(b.x,b.y,10*(b.s+0.8),0,Math.PI*2,0);
            ctx.fill();
            ctx.stroke();
        }
        count++;
        requestAnimationFrame(aaa);
    }

    requestAnimationFrame(aaa);
}
function createAccountLabel(name, address, amount = 0) {
    const accountLabel = document.createElement('div');
    accountLabel.classList.add('accountLabel');

    const accountImgWrap = document.createElement('div');
    accountImgWrap.classList.add('accountImgWrap');
    accountLabel.appendChild(accountImgWrap);
    const accountImgWrapDivA = document.createElement('div');
    accountImgWrap.appendChild(accountImgWrapDivA);
    const accountImgWrapDivB = document.createElement('div');
    accountImgWrap.appendChild(accountImgWrapDivB);
    const img = patternGenerator.generateImage(address, UX_SETTINGS.shapes);
    accountImgWrap.appendChild(img);

    const accountLabelInfoWrap = document.createElement('div');
    accountLabelInfoWrap.classList.add('accountLabelInfoWrap');
    accountLabel.appendChild(accountLabelInfoWrap);

    const accountLabelNameAndValueWrap = document.createElement('div');
    accountLabelNameAndValueWrap.classList.add('accountLabelNameAndValueWrap');
    accountLabelInfoWrap.appendChild(accountLabelNameAndValueWrap);

    const h2 = document.createElement('h2');
    h2.innerText = name;
    accountLabelNameAndValueWrap.appendChild(h2);

    const h3 = document.createElement('h3');
    h3.innerText = `${utils.convert.number.formatNumberAsCurrency(amount)}c`;
    accountLabelNameAndValueWrap.appendChild(h3);

    const accountLabelAddress = document.createElement('div');
    accountLabelAddress.classList.add('accountLabelAddress');
    accountLabelInfoWrap.appendChild(accountLabelAddress);

    const h3Address = document.createElement('h3');
    h3Address.innerText = address;
    accountLabelAddress.appendChild(h3Address);

    return accountLabel;
}
function updateActiveAccountLabel() {
    const accountLabels = eHTML.accountsWrap.getElementsByClassName('accountLabel');
    if (accountLabels.length === 0) { return; }

    const activeAccountIndex = activeAccountIndexByPrefix[activeAddressPrefix];
    for (let i = 0; i < accountLabels.length; i++) {
        accountLabels[i].classList.remove('active');
        if (i !== activeAccountIndex) { continue; }
        accountLabels[i].classList.add('active');
    }
}
function updateAccountsLabels() {
    const accounts = activeWallet.accounts[activeAddressPrefix];
    if (accounts.length === 0) { return; }
    
    const accountLabels = eHTML.accountsWrap.getElementsByClassName('accountLabel');
    for (let i = 0; i < accounts.length; i++) {
        const account = accounts[i];
        const accountName = `Account ${i + 1}`;
        const existingAccountLabel = accountLabels[i];
        if (existingAccountLabel) { // fill existing label
            const name = existingAccountLabel.getElementsByClassName('accountLabelNameAndValueWrap')[0].getElementsByTagName('h2')[0];
            const address = existingAccountLabel.getElementsByClassName('accountLabelAddress')[0].getElementsByTagName('h3')[0];
            const amount = existingAccountLabel.getElementsByClassName('accountLabelNameAndValueWrap')[0].getElementsByTagName('h3')[0];

            name.innerText = accountName;
            address.innerText = account.address;
            amount.innerText = `${utils.convert.number.formatNumberAsCurrency(account.balance)}c`;
            continue;
        }

        const accountLabel = createAccountLabel(accountName, account.address, account.balance);
        eHTML.accountsWrap.insertBefore(accountLabel, eHTML.newAddressBtn);
    }

    //console.log(`Accounts labels updated: ${accounts.length}`);
}
function updateAccountLabel(account) {
    let labelUpdated = false;

    const accountLabels = eHTML.accountsWrap.getElementsByClassName('accountLabel');
    for (let i = 0; i < accountLabels.length; i++) {
        const address = accountLabels[i].getElementsByClassName('accountLabelAddress')[0].getElementsByTagName('h3')[0];
        if (address.innerText !== account.address) { continue; }

        const amount = accountLabels[i].getElementsByClassName('accountLabelNameAndValueWrap')[0].getElementsByTagName('h3')[0];
        amount.innerText = `${utils.convert.number.formatNumberAsCurrency(account.balance)}c`;
        labelUpdated = true;
        break;
    }
    
    if (!labelUpdated) {
        const accountLabel = createAccountLabel(`Account ${i + 1}`, account.address, account.balance);
        eHTML.accountsWrap.insertBefore(accountLabel, eHTML.newAddressBtn);
    }

    //console.log(`Account label updated: ${account.address}`);
}
async function updateTotalBalances() {
    let walletTotalBalance = 0;
    let walletTotalSpendableBalance = 0;
    let walletTotalStakedBalance = 0;
 
    const addressTypes = Object.keys(activeWallet.accounts);
    for (let i = 0; i < addressTypes.length; i++) {
        const addressPrefix = addressTypes[i];
        const showInLabelsWrap = addressPrefix === activeAddressPrefix;
        const { totalBalance, totalSpendableBalance, totalStakedBalance } = calculateTotalOfBalances(addressPrefix, showInLabelsWrap);
        walletTotalBalance += totalBalance;
        walletTotalSpendableBalance += totalSpendableBalance;
        walletTotalStakedBalance += totalStakedBalance;
    }

    eHTML.spendableBalanceStr.innerText = utils.convert.number.formatNumberAsCurrency(walletTotalBalance);
    eHTML.stakedStr.innerText = utils.convert.number.formatNumberAsCurrency(walletTotalStakedBalance);

    //console.log(`[POPUP] totalBalances updated: ${walletTotalBalance}c, from ${activeWallet.accounts[activeAddressPrefix].length} accounts`);
}
function calculateTotalOfBalances(addressPrefix = defaultAddressPrefix) {
    let totalBalance = 0;
    let totalSpendableBalance = 0;
    let totalStakedBalance = 0;
    const nbOfAccounts = activeWallet.accounts[addressPrefix].length;
    for (let i = 0; i < nbOfAccounts; i++) {
        const account = activeWallet.accounts[addressPrefix][i];
        totalBalance += account.balance;
        totalSpendableBalance += account.spendableBalance;
        totalStakedBalance += account.stakedBalance || 0;
    }

    return { totalBalance, totalSpendableBalance, totalStakedBalance };
}
function updateMiniFormsInfoRelatedToActiveAccount() {
    const activeAccount = activeWallet.accounts[activeAddressPrefix][activeAccountIndexByPrefix[activeAddressPrefix]];
    eHTML.send.senderAddress.innerText = activeAccount.address;
    eHTML.stake.senderAddress.innerText = activeAccount.address;
}
function newAddressBtnLoadingToggle() {
    const isGenerating = eHTML.newAddressBtn.innerHTML !== '+';

    if (isGenerating) {
        eHTML.newAddressBtn.classList.remove('loading');
        if (animations.newAddressBtn) { animations.newAddressBtn.pause(); }
        animations.newAddressBtn = anime({
            targets: eHTML.newAddressBtn,
            width: '34px',
            duration: 200,
            easing: 'easeInOutQuad',
            complete: () => { 
                eHTML.newAddressBtn.innerHTML = '+';
                animations.newAddressBtn = null; 
            }
        });
    } else {
        eHTML.newAddressBtn.classList.add('loading');
        eHTML.newAddressBtn.innerHTML = htmlAnimations.horizontalBtnLoading;
        if (animations.newAddressBtn) { animations.newAddressBtn.pause(); }
        animations.newAddressBtn = anime({
            targets: eHTML.newAddressBtn,
            width: ['80px', '200px', '80px'],
            duration: 1600,
            loop: true,
            easing: 'easeInOutQuad'
        });
    }
}
/** @param {AddressExhaustiveData} addressExhaustiveData */
function fillTxHistoryWithActiveAddressData(maxTxs = 16) {
    const txHistoryTable = eHTML.txHistoryTable;
    const tbody = txHistoryTable.getElementsByTagName('tbody')[0];
    tbody.innerHTML = '';

    const activeAddress = activeWallet.accounts[activeAddressPrefix][activeAccountIndexByPrefix[activeAddressPrefix]].address;
    eHTML.txHistoryAddress.innerText = activeAddress;

    const addressExhaustiveData = addressesExhaustiveData[activeAddress];
    if (!addressExhaustiveData) { return; }
    
    // FILLING THE ADDRESS TXS HISTORY
    const txsReferences = addressExhaustiveData.addressTxsReferences || [];
    let shownTxs = 0;
    let shownTxsReferences = [];
    for (let i = txsReferences.length; i > 0; i--) {
        const txReference = txsReferences[i - 1];
        const row = createHtmlElement('tr', undefined, ['w-addressTxRow'], tbody);
        createHtmlElement('td', undefined, ['w-addressTxAmount'], row).textContent = '...';
        createHtmlElement('td', undefined, ['w-addressTxFee'], row).textContent = '...';
        createHtmlElement('td', undefined, ['w-addressTxReference'], row).textContent = txReference;
        createHtmlElement('td', undefined, ['w-addressTxStatus'], row).textContent = '...';

        shownTxsReferences.push(txReference);
        
        shownTxs++;
        //console.log(`shownTxs: ${shownTxs} / ${maxTxs}`);
        if (shownTxs >= maxTxs) { break; }
    }
    
    for (const txReference of shownTxsReferences) {
        chrome.runtime.sendMessage({ action: "get_transaction_with_balanceChange_by_reference", txReference, address: activeAddress });
    }
}
/** @param {TransactionWithDetails} txWithDetails */
function fillInfoOfTxInHistory(txWithDetails) {
    const txRef = txWithDetails.txReference;

    const txHistoryTable = eHTML.txHistoryTable;
    const tbody = txHistoryTable.getElementsByTagName('tbody')[0];
    for (const txRow of tbody.getElementsByTagName('tr')) {
        if (txRow.getElementsByTagName('td')[2].textContent !== txRef) { continue; }

        const amountText = txRow.getElementsByClassName('w-addressTxAmount')[0];
        amountText.textContent = utils.convert.number.formatNumberAsCurrencyChange(txWithDetails.balanceChange);
        const feeText = txRow.getElementsByClassName('w-addressTxFee')[0];
        feeText.textContent = utils.convert.number.formatNumberAsCurrency(txWithDetails.fee);
        const statusText = txRow.getElementsByClassName('w-addressTxStatus')[0];
        statusText.textContent = 'confirmed';
        break;
    }
}
function createHtmlElement(tag, id, classes = [], divToInject = undefined) {
    /** @type {HTMLElement} */
    const element = document.createElement(tag);
    if (id) { element.id = id; }

    for (const cl of classes) { element.classList.add(cl); }

    if (divToInject) { divToInject.appendChild(element); }
    return element;
}
function holdBtnMouseUp(target, duration = 1000) {
    const initialBackground = 'linear-gradient(90deg, var(--color2) 0%, var(--color1) 0%)';

    return anime({
        targets: target,
        background: initialBackground,
        duration,
        easing: 'easeInOutQuad',
        complete: () => {
            target.style.background = initialBackground;
        }
    });
}
function holdBtnMouseDown(target, completeFnc, duration = 2000) {
    const computedStyle = getComputedStyle(target);
    const bImage = computedStyle.backgroundImage;
    const perc1 = bImage === 'none' ? 0 : bImage.split('%')[0].split(' ')[bImage.split('%')[0].split(' ').length - 1];
    const perc2 = bImage === 'none' ? 0 : bImage.split('%')[1].split(' ')[bImage.split('%')[1].split(' ').length - 1];
    target.style.background = `linear-gradient(90deg, var(--color2) ${perc1}%, var(--color1) ${perc2}%)`;

    return anime({
        targets: target,
        background: 'linear-gradient(90deg, var(--color2) 100%, var(--color1) 102%)',
        duration,
        easing: 'easeInOutQuad',
        complete: () => { completeFnc(); }
    });
}
//#endregion

//#region - FUNCTIONS
(async () => { // --- START ---
    initUI();
    setWaitingForConnectionFormLoading();

    setInitialInputValues();

    const authInfoResult = await chrome.storage.local.get(['authInfo']);
    /** @type {AuthInfo} */
    const sanitizedAuthInfo = authInfoResult.authInfo ? sanitizer.sanitize(authInfoResult.authInfo) : {};
    showFormDependingOnStoredPassword(sanitizedAuthInfo);

    while(!window.blockExplorerWidget) {
        console.log('Waiting for blockExplorerWidget...');
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    blockExplorerWidget = window.blockExplorerWidget;
    console.log('blocksTimeInterval:', blockExplorerWidget.blocksTimeInterval);
})();
async function setNewPassword(password, passComplement = false) {
    const startTimestamp = Date.now();

    const passwordReadyUse = passComplement ? `${password}${passComplement}` : password;
    const authInfo = await cryptoLight.generateKey(passwordReadyUse);
    if (!authInfo || !authInfo.encodedHash || !authInfo.salt1Base64 || !authInfo.iv1Base64) { console.error('cryptoLight.generateKey() failed'); return false; }

    const weakEncryptionReady = await cryptoLight.generateKey(password, authInfo.salt1Base64, authInfo.iv1Base64);
    if (!weakEncryptionReady) { console.error('cryptoLight.generateKey() failed'); return false; }
    if (authInfo.salt1Base64 !== weakEncryptionReady.salt1Base64 || authInfo.iv1Base64 !== weakEncryptionReady.iv1Base64) { console.error('Salt1 or IV1 mismatch'); return false; }
    
    const authToken = cryptoLight.generateRndBase64(32); // authToken - used to authenticate the user on the server
    const authTokenHash = await cryptoLight.encryptText(authToken);

    const encryptedPassComplement = passComplement ? await cryptoLight.encryptText(passComplement) : false;
    if (passComplement && !encryptedPassComplement) { console.error('Pass complement encryption failed'); return false; }
    //cryptoLight.clear();
    //console.log('cryptoLight.clear() done');

    const authID = generateAuthID(); // authID - used to link the passComplement on the server
    await chrome.storage.local.set({
        authInfo: {
            appVersion: settings.appVersion,
            authID,
            authToken,
            hash: authInfo.encodedHash,
            salt1Base64: authInfo.salt1Base64,
            iv1Base64: authInfo.iv1Base64,
            serverAuthBoost: passComplement ? true : false
        }
    }, function () {
        console.log(`Password set, salt1: ${authInfo.salt1Base64}, iv1: ${authInfo.iv1Base64}`);
    });

    const totalTimings = {
        argon2Time: authInfo.argon2Time + weakEncryptionReady.argon2Time,
        deriveKTime: authInfo.deriveKTime + weakEncryptionReady.deriveKTime,
        total: Date.now() - startTimestamp
    };
    return passComplement ? { authID, authTokenHash, encryptedPassComplement, totalTimings } : true;
}
async function resetApplication() {
    await chrome.runtime.sendMessage({action: "unsubscribe_all" });
    await chrome.storage.local.clear(function() {
        var error = chrome.runtime.lastError;
        if (error) {
            console.error(error);
        } else {
            console.log('Application reset');
            //setVisibleForm('passwordCreationForm');
            //eHTML.passwordCreationFormInputPassword.focus();
            // close popup
            window.close();
        }
    });
}
function rnd(min, max) { return Math.floor(Math.random() * (max - min + 1) + min); }
function generateAuthID(length = 32) {
    const authorized = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += authorized[rnd(0, authorized.length - 1)];
    }
    return result;
}
function strToMaxLen(str, maxLen) {
    if (str.length <= maxLen + 3) { return str; }

    const half = Math.floor(maxLen / 2);
    return `${str.slice(0, half)}...${str.slice(-half)}`;
}
async function copyTextToClipboard(str) {
    try {
      await navigator.clipboard.writeText(str);
      console.log("Text copied to clipboard");
    } catch (err) {
      console.error("Failed to copy text to clipboard: ", err);
    }
}
async function getWalletInfo(walletIndex = 0) {
    const loadedWalletsInfo = await chrome.storage.local.get('walletsInfo');
    if (!loadedWalletsInfo) { console.error('No wallets info'); return; }
    if (loadedWalletsInfo.walletsInfo.length === 0) { console.error('No wallets info [].len === 0'); return; }
    return loadedWalletsInfo.walletsInfo[walletIndex];
}
async function setWalletInfo(walletIndex = 0, walletInfo) {
    const loadedWalletsInfo = await chrome.storage.local.get('walletsInfo');
    if (!loadedWalletsInfo) { console.error('No wallets info'); return; }
    
    loadedWalletsInfo.walletsInfo[walletIndex] = walletInfo;
    await chrome.storage.local.set(loadedWalletsInfo);
}
async function getWalletPrivateKey(walletIndex = 0) {
    const loadedWalletsInfo = await chrome.storage.local.get('walletsInfo');
    if (!loadedWalletsInfo) { console.error('No wallets info'); return; }
    if (loadedWalletsInfo.walletsInfo.length === 0) { console.error('No wallets info [].len === 0'); return; }
    const walletsInfo = loadedWalletsInfo.walletsInfo;
    const encryptedSeedHex = walletsInfo[walletIndex].encryptedSeedHex;
    return await cryptoLight.decryptText(encryptedSeedHex);
}
function getWalletAccountIndexByAddress(address) {
    const targetAddressPrefix = address.slice(0, 1);
    const addressTypes = Object.keys(activeWallet.accounts);
    for (let i = 0; i < addressTypes.length; i++) {
        const addressPrefix = addressTypes[i];
        if (addressPrefix !== targetAddressPrefix) { continue; }

        const accounts = activeWallet.accounts[addressPrefix];
        for (let j = 0; j < accounts.length; j++) {
            if (accounts[j].address === address) { return j; }
        }
    }
    return -1;
}
async function saveWalletGeneratedAccounts(walletIndex = 0) {
    const walletInfo = await getWalletInfo(walletIndex);
    walletInfo.accountsGenerated = activeWallet.accountsGenerated || {};
    await setWalletInfo(walletIndex, walletInfo);
}
async function loadWalletGeneratedAccounts(walletInfo) {
    activeWallet.accountsGenerated = walletInfo.accountsGenerated || {};
    if (!walletInfo.accountsGenerated || !walletInfo.accountsGenerated[activeAddressPrefix]) { return; }
    if (walletInfo.accountsGenerated[activeAddressPrefix].length === 0) { return; }

    const nbOfExistingAccounts = walletInfo.accountsGenerated[activeAddressPrefix].length;
    if (nbOfExistingAccounts === 0) { console.error('No existing accounts'); return; }

    /** @type {Account[]} */
    const derivedAccounts = await activeWallet.deriveAccounts(nbOfExistingAccounts, activeAddressPrefix);
    if (!derivedAccounts) { console.error('Derivation failed'); return; }

    updateAccountsLabels();
    updateActiveAccountLabel();
    
    const nbOfAccounts = activeWallet.accounts[activeAddressPrefix].length;
    console.log(`[POPUP] wallet accounts loaded: ${nbOfAccounts}`);
}
/** @param {UTXO[]} utxos */
async function extractDataFromAccountUTXOs(address, utxos) {
    let balance = 0;
    let spendableBalance = 0;
    let stakedBalance = 0;
    const spendableUTXOs = [];

    for (const utxo of utxos) {
        balance += utxo.amount;
        //if (address === 'WYnwjFkgumbp3jBCUoz5') console.log(`utxo: ${utxo.amount} ${utxo.rule} ${utxo.anchor}`);
        if (utxo.rule === 'sigOrSlash') { stakedBalance += utxo.amount; continue; }

        spendableUTXOs.push(utxo);
        spendableBalance += utxo.amount;
    }

    return { balance, spendableBalance, stakedBalance, spendableUTXOs };
}
function updateAddressExhaustiveDataFromNode(address) {
    let from = 0;

    if (addressesExhaustiveData[address]) {
        const highestKnownTxsHeight = addressesExhaustiveData[address].highestKnownTxsHeight();
        const highestKnownUTXOsHeight = addressesExhaustiveData[address].highestKnownUTXOsHeight();
        from = Math.min(highestKnownTxsHeight, highestKnownUTXOsHeight);
    }
    console.log(`Updating ${address} from: ${from}`);
    chrome.runtime.sendMessage({action: 'get_address_exhaustive_data', address, from });
}
//#endregion

//#region - EVENT LISTENERS
document.addEventListener('submit', function(e) {
    e.preventDefault();
});
eHTML.passwordCreationForm.addEventListener('submit', async function(e) {
    if (busy.includes('passwordCreationForm')) return;
    busy.push('passwordCreationForm');

    e.preventDefault();
    const serverAuthBoost = false;
    cryptoLight.cryptoStrength = serverAuthBoost ? 'medium' : 'heavy';
    console.log(`serverAuthBoost: ${serverAuthBoost}`);

    const passComplement = serverAuthBoost ? cryptoLight.generateRndBase64(32) : false;
    const passwordMinLength = serverAuthBoost ? 12 : 4;
    const password = eHTML.passwordCreationFormInputPassword.value;
    const passwordConfirm = eHTML.passwordCreationFormInputConfirm.value;
    
    if (password !== passwordConfirm) {
        busy.splice(busy.indexOf('passwordCreationForm'), 1);
        alert('Passwords do not match');
        return;
    } else if (password.length < passwordMinLength) {
        busy.splice(busy.indexOf('passwordCreationForm'), 1);
        alert(`Password must be at least ${passwordMinLength} characters long`);
        return;
    }

    const button = eHTML.passwordCreationForm.getElementsByTagName('button')[0];
    button.innerHTML = htmlAnimations.horizontalBtnLoading;
    const passwordCreatedInfo = await setNewPassword(password, passComplement);
    setTimeout(() => { button.innerHTML = 'Set password'; }, 1000);
    if (!passwordCreatedInfo) { alert('Password setting failed'); busy.splice(busy.indexOf('passwordCreationForm'), 1); return; }

    eHTML.passwordCreationFormInputPassword.value = '';
    eHTML.passwordCreationFormInputConfirm.value = '';

    if (serverAuthBoost) {
        const { authID, authTokenHash, encryptedPassComplement, totalTimings } = passwordCreatedInfo;
        const keyPair = await cryptoLight.generateKeyPair();
        const exportedPubKey = await cryptoLight.exportPublicKey(keyPair.publicKey);

        const serverResponse = await communication.sharePubKeyWithServer(authID, exportedPubKey);
        if (!serverResponse) { alert('Server communication failed'); busy.splice(busy.indexOf('passwordCreationForm'), 1); resetApplication(); return; }
        if (!serverResponse.success) { alert(serverResponse.message); busy.splice(busy.indexOf('passwordCreationForm'), 1); resetApplication(); return; }

        const serverPublicKey = await cryptoLight.publicKeyFromExported(serverResponse.serverPublicKey);

        const serverResponse2 = await communication.sendAuthDataToServer(serverPublicKey, authID, authTokenHash, encryptedPassComplement, totalTimings);
        if (!serverResponse2) { alert('Server communication failed'); busy.splice(busy.indexOf('passwordCreationForm'), 1); resetApplication(); return; }
        if (!serverResponse2.success) { alert(serverResponse2.message); busy.splice(busy.indexOf('passwordCreationForm'), 1); resetApplication(); return; }
    }

    setVisibleForm('createWalletForm');
    //chrome.runtime.sendMessage({action: "openPage", password: passComplement ? `${password}${passComplement}` : password });
    chrome.runtime.sendMessage({action: 'authentified', password: passComplement ? `${password}${passComplement}` : password });

    busy.splice(busy.indexOf('passwordCreationForm'), 1);
});
eHTML.loginForm.addEventListener('submit', async function(e) {
    if (busy.includes('loginForm')) { return; }
    busy.push('loginForm');

    e.preventDefault();
    const targetForm = eHTML.loginForm;
    const input = targetForm.getElementsByTagName('input')[0];
    let passwordReadyUse = input.value;
    input.value = '';
    if (passwordReadyUse === '') { busy.splice(busy.indexOf('loginForm'), 1); return; }

    const button = targetForm.getElementsByTagName('button')[0];
    button.innerHTML = htmlAnimations.horizontalBtnLoading;
    button.classList.add('clicked');

    function infoAndWrongAnim(text) {
		textInfo(targetForm, text);
		input.classList.add('wrong');
        cryptoLight.clear();
        button.innerHTML = 'UNLOCK';
	}

    const authInfoResult = await chrome.storage.local.get(['authInfo']);
    if (!authInfoResult || !authInfoResult.authInfo) { infoAndWrongAnim('Password not set'); busy.splice(busy.indexOf('loginForm'), 1); return; }

    const startTimestamp = Date.now();
    const totalTimings = { argon2Time: 0, deriveKTime: 0, total: 0 };

    const { authID, authToken, hash, salt1Base64, iv1Base64, serverAuthBoost } = sanitizer.sanitize(authInfoResult.authInfo);
    const passwordMinLength = serverAuthBoost ? 12 : 4;
    if (passwordReadyUse.length < passwordMinLength) { infoAndWrongAnim(`Password must be at least ${passwordMinLength} characters long`); busy.splice(busy.indexOf('loginForm'), 1); return; }

    if (!hash || !salt1Base64 || !iv1Base64) { infoAndWrongAnim('Password not set'); busy.splice(busy.indexOf('loginForm'), 1); return; }
    if (typeof hash !== 'string' || typeof salt1Base64 !== 'string' || typeof iv1Base64 !== 'string') { console.error('Password data corrupted'); busy.splice(busy.indexOf('loginForm'), 1); return; }
    cryptoLight.cryptoStrength = serverAuthBoost ? 'medium' : 'heavy';

    if (serverAuthBoost) { // DEPRECATED
        const weakEncryptionReady = await cryptoLight.generateKey(passwordReadyUse, salt1Base64, iv1Base64);
        if (!weakEncryptionReady) { infoAndWrongAnim('Weak encryption failed'); busy.splice(busy.indexOf('loginForm'), 1); return; }
        const authTokenHash = await cryptoLight.encryptText(authToken);
        totalTimings.argon2Time = weakEncryptionReady.argon2Time;
        totalTimings.deriveKTime = weakEncryptionReady.deriveKTime;
        console.log(`weakEncryption time: ${totalTimings.argon2Time + totalTimings.deriveKTime} ms`);

        const keyPair = await cryptoLight.generateKeyPair();
        const exportedPubKey = await cryptoLight.exportPublicKey(keyPair.publicKey);

        const serverResponse = await communication.sharePubKeyWithServer(authID, exportedPubKey);
        if (!serverResponse) { infoAndWrongAnim('Server communication failed'); busy.splice(busy.indexOf('loginForm'), 1); return; }
        if (!serverResponse.success) { infoAndWrongAnim(serverResponse.message); busy.splice(busy.indexOf('loginForm'), 1); return; }

        const serverPublicKey = await cryptoLight.publicKeyFromExported(serverResponse.serverPublicKey);

        const serverResponse2 = await communication.sendAuthDataToServer(serverPublicKey, authID, authTokenHash, false);
        if (!serverResponse2) { infoAndWrongAnim('Server communication failed'); busy.splice(busy.indexOf('loginForm'), 1); return; }
        if (!serverResponse2.success) { infoAndWrongAnim(`authID: ${authID}\n${serverResponse2.message}`); busy.splice(busy.indexOf('loginForm'), 1); return; }

        const encryptedPassComplementEnc = serverResponse2.encryptedPassComplement;
        const encryptedPassComplement = await cryptoLight.decryptData(keyPair.privateKey, encryptedPassComplementEnc);
        const passComplement = await cryptoLight.decryptText(encryptedPassComplement);

        passwordReadyUse = `${passwordReadyUse}${passComplement}`;
    }

    const res = await cryptoLight.generateKey(passwordReadyUse, salt1Base64, iv1Base64, hash);
    button.innerHTML = 'UNLOCK';
    button.classList.remove('clicked');
    if (!res) { infoAndWrongAnim('Key derivation failed'); busy.splice(busy.indexOf('loginForm'), 1); return; }

    totalTimings.argon2Time += res.argon2Time;
    totalTimings.deriveKTime += res.deriveKTime;
    totalTimings.total = Date.now() - startTimestamp;
    //console.log(totalTimings);

    if (!res.hashVerified) { infoAndWrongAnim('Wrong password'); busy.splice(busy.indexOf('loginForm'), 1); return; }

    const walletsInfoResult = await chrome.storage.local.get(['walletsInfo']);
    if (!walletsInfoResult || !walletsInfoResult.walletsInfo || walletsInfoResult.walletsInfo.length === 0) {
        console.log('No wallets info, open create wallet form');
        setVisibleForm('createWalletForm'); return;
    }

    const walletsInfo = walletsInfoResult.walletsInfo;
    console.log(`Wallets info loaded, first walletName: ${walletsInfo[0].name}`);

    const walletInfo = await getWalletInfo(selectedWalletIndex);
    activeWallet = new Wallet(await cryptoLight.decryptText(walletInfo.encryptedSeedHex));
    console.log('walletInfo:', walletInfo);
    await loadWalletGeneratedAccounts(walletInfo);
    
    chrome.runtime.sendMessage({action: 'authentified', password: passwordReadyUse });
    if (activeWallet.accounts[activeAddressPrefix][0]) {
        for (let i = 0; i < activeWallet.accounts[activeAddressPrefix].length; i++) {
            const address = activeWallet.accounts[activeAddressPrefix][i].address;
            updateAddressExhaustiveDataFromNode(address);
            //chrome.runtime.sendMessage({action: 'get_address_exhaustive_data', address });
            chrome.runtime.sendMessage({action: 'subscribe_balance_update', address });
        }
    }

    setVisibleForm('walletForm');

    passwordReadyUse = null;
    busy.splice(busy.indexOf('loginForm'), 1);
});

document.addEventListener('mouseup', function(e) { // release click
    switch (e.target.id) {
        case 'deleteDataBtn':
            if (animations.deleteDataBtn) {
                animations.deleteDataBtn.pause();
                textInfo(eHTML.settingsForm, 'Hold the button to confirm');
            }
            animations.deleteDataBtn = holdBtnMouseUp(e.target);
            break;
        default:
            break;
    }

    switch (e.target.className) {
        case 'sendBtn holdBtn':
            if (animations.sendBtn) {
                animations.sendBtn.pause();
                textInfo(eHTML.send.miniForm, 'Hold the button to confirm');
            }
            animations.sendBtn = holdBtnMouseUp(e.target);
            break;
        case 'stakeBtn holdBtn':
            if (animations.stakeBtn) {
                animations.stakeBtn.pause();
                textInfo(eHTML.stake.miniForm, 'Hold the button to confirm');
            }
            animations.stakeBtn = holdBtnMouseUp(e.target);
            break;
        default:
            break;
    }
});
document.addEventListener('mousedown', function(e) { // hold click
    switch (e.target.id) {
        case 'deleteDataBtn':
            if (animations.deleteDataBtn) { animations.deleteDataBtn.pause(); }

            animations.deleteDataBtn = holdBtnMouseDown(e.target, () => {
                resetApplication();
                e.target.style.background = 'white';
            });
            break;
        default:
            break;
    }

    switch (e.target.className) {
        case 'sendBtn holdBtn':
            if (eHTML.send.amount.value === '') { textInfo(eHTML.send.miniForm, 'Amount is empty'); return; }
            if (eHTML.send.address.value === '') { textInfo(eHTML.send.miniForm, 'Address is empty'); return; }
            if (animations.sendBtn) { animations.sendBtn.pause(); }

            animations.sendBtn = holdBtnMouseDown(e.target, async () => {
                console.log('sendBtn');
                amount = parseInt(eHTML.send.amount.value.replace(",","").replace(".",""));
                console.log('amount:', amount);
                // utils.addressUtils.conformityCheck(eHTML.send.address.value);
                receiverAddress = eHTML.send.address.value;
                senderAccount = activeWallet.accounts[activeAddressPrefix][activeAccountIndexByPrefix[activeAddressPrefix]];
                const createdSignedTx = await Transaction_Builder.createAndSignTransfer(senderAccount, amount, receiverAddress);
                if (!createdSignedTx.signedTx) {
                    console.error('Transaction creation failed', createdSignedTx.error);
                    //Error: Invalid address length !== 20
                    let infoText = createdSignedTx.error;
                    if (createdSignedTx.error.includes('Invalid address')) { infoText = 'Invalid address'; }
                    textInfo(eHTML.send.miniForm, infoText);
                    return;
                }
                
                console.log('transaction:', createdSignedTx.signedTx);
                chrome.runtime.sendMessage({action: "broadcast_transaction", transaction: createdSignedTx.signedTx, senderAddress: senderAccount.address });
                e.target.style.background = 'linear-gradient(90deg, var(--color2) 0%, var(--color1) 0%)';
                animations.sendBtn = null;
            });
            break;
        case 'stakeBtn holdBtn':
            if (eHTML.stake.amount.value === '') { textInfo(eHTML.stake.miniForm, 'Amount is empty'); return; }
            if (animations.stakeBtn) { animations.stakeBtn.pause(); animations.sendBtn = null; }
            
            animations.stakeBtn = holdBtnMouseDown(e.target, async () => {
                console.log('stakeBtn');
                    amount = parseInt(eHTML.stake.amount.value.replace(",","").replace(".",""));
                    console.log('amount:', amount);
        
                    senderAccount = activeWallet.accounts[activeAddressPrefix][activeAccountIndexByPrefix[activeAddressPrefix]];
                    createdTx = await Transaction_Builder.createStakingVss(senderAccount, senderAccount.address, amount);
                    if (!createdTx) {
                        console.error('Transaction creation failed');
                        textInfo(eHTML.stake.miniForm, 'Transaction creation failed');
                        return;
                    }
        
                    signedTx = await senderAccount.signTransaction(createdTx);
                    if (!signedTx) {
                        console.error('Transaction signing failed');
                        textInfo(eHTML.stake.miniForm, 'Transaction signing failed');
                        return;
                    }
        
                    console.log('transaction:', signedTx);
                    chrome.runtime.sendMessage({action: "broadcast_transaction", transaction: signedTx, senderAddress: senderAccount.address });
                    e.target.style.background = 'linear-gradient(90deg, var(--color2) 0%, var(--color1) 0%)';
            });
            break;
        default:
            break;
    }
});
document.addEventListener('click', async function(e) {
    let target = e.target;
    if (target.tagName === 'TD') { target = target.parentElement; }

    let loadedWalletsInfo;
    let walletsInfo;
    let encryptedSeedHex;
    let privateKeyHex;
    let walletInfo;

    let amount;
    let receiverAddress;
    let senderAddress;
    let senderAccount;
    let transaction;
    /** @type {Transaction} */
    let createdTx;
    /** @type {Transaction} */
    let signedTx;
    switch (target.id) {
        case 'randomizeBtn':
            const rndSeedHex = cryptoLight.generateRdnHex(64);
            eHTML.privateKeyHexInput.value = strToMaxLen(rndSeedHex, 21);
            eHTML.privateKeyHexInput.placeholder = rndSeedHex;
            eHTML.privateKeyHexInput.readOnly = true;
            eHTML.confirmPrivateKeyBtn.classList.remove('disabled');
            break;
        case 'privateKeyHexInput':
            if (!eHTML.privateKeyHexInput.readOnly) { return; } // if not readOnly, do nothing
            copyTextToClipboard(eHTML.privateKeyHexInput.placeholder);
            textInfo(eHTML.createWalletForm, 'Private key copied to clipboard');
            break;
        case 'confirmPrivateKeyBtn':
            if (target.classList.contains('disabled')) { return; }
            encryptedSeedHex = await cryptoLight.encryptText(eHTML.privateKeyHexInput.placeholder);
            activeWallet = new Wallet(eHTML.privateKeyHexInput.placeholder);
            eHTML.privateKeyHexInput.placeholder = 'Private key';
            walletInfo = new WalletInfo({name: 'wallet1', encryptedSeedHex: encryptedSeedHex});
            loadedWalletsInfo = await chrome.storage.local.get('walletsInfo');
            walletsInfo = loadedWalletsInfo && loadedWalletsInfo.walletsInfo ? loadedWalletsInfo.walletsInfo : [];
            walletsInfo.push(walletInfo.extractVarsObjectToSave());

            await chrome.storage.local.set({walletsInfo});
            setVisibleForm('walletForm');
            console.log('Private key set');
            break;
        case 'walletBtn':
            if (!target.classList.contains('active')) { return; }
            setVisibleForm('walletForm', false);
            break;
        case 'explorerBtn':
            if (!target.classList.contains('active')) { return; }
            //setVisibleForm('explorerForm', true);
            toggleExplorer();
            break;
        case 'newAddressBtn':
            if (target.innerHTML !== '+') { console.log('Already generating new address'); return; }
            privateKeyHex = await getWalletPrivateKey(selectedWalletIndex);

            newAddressBtnLoadingToggle();
            console.log('privateKeyHex:', privateKeyHex);
            const nbOfExistingAccounts = activeWallet.accounts[activeAddressPrefix].length;
            if (nbOfExistingAccounts === 0) { activeWallet.accountsGenerated = { [activeAddressPrefix]: [] }; }

            const derivedAccounts = await activeWallet.deriveAccounts(nbOfExistingAccounts + 1, activeAddressPrefix);
            newAddressBtnLoadingToggle();
            if (!derivedAccounts) { console.error('Derivation failed'); return; }

            await saveWalletGeneratedAccounts(selectedWalletIndex);
            console.log('[POPUP] wallet accounts generated and saved');

            updateAccountsLabels();

            const lastAccountAddress = activeWallet.accounts[activeAddressPrefix][nbOfExistingAccounts].address;
            chrome.runtime.sendMessage({action: "get_address_exhaustive_data", address: lastAccountAddress });
            chrome.runtime.sendMessage({action: "subscribe_balance_update", address: lastAccountAddress });
            break;
        case 'buttonBarSend':
            console.log('buttonBarSpend');
            toggleMiniForm(eHTML.send.miniForm);
            break;
        case 'buttonBarSwap':
            console.log('buttonBarSwap');
            break;
        case 'buttonBarStake':
            console.log('buttonBarStake');
            toggleMiniForm(eHTML.stake.miniForm);
            break;
        case 'buttonBarSpecial':
            console.log('buttonBarSpecial');
            break;
        case 'createWalletBtn':
        case 'miningBtn':
            if (!target.classList.contains('active')) { return; }
            setVisibleForm('miningForm', false);
            break;
        case 'settingsBtn':
            if (!target.classList.contains('active')) { return; }
            setVisibleForm('settingsForm', false);
            break;
        default:
            //console.log(`clicked: ${target.id}`);
            break;
    }

    switch (target.className) {
        case 'accountImgWrap':
            //console.log('accountImgWrap clicked');
            const accountLabel = target.parentElement;
            const accountIndex = Array.from(accountLabel.parentElement.children).indexOf(accountLabel);

            //console.log(`accountIndex: ${accountIndex}`);
            activeAccountIndexByPrefix[activeAddressPrefix] = accountIndex;
            updateActiveAccountLabel();
            updateMiniFormsInfoRelatedToActiveAccount();

            const explorerOpenned = !eHTML.popUpExplorer.classList.contains('hidden');
            if (!explorerOpenned) { return; }
                
            updateAddressExhaustiveDataFromNode(activeWallet.accounts[activeAddressPrefix][accountIndex].address);

            break;
        case 'foldBtn':
            console.log('foldBtn');
            toggleMiniForm(target.parentElement);
            break;
        case 'w-addressTxRow':
            const txReference = target.querySelector('.w-addressTxReference').textContent;
            const isConformTxReference = utils.types.txReference.isConform(txReference);
            if (!isConformTxReference) { console.error('Invalid txReference'); return; }

            blockExplorerWidget.navigationTarget.blockReference = Number(txReference.split(':')[0]);
            blockExplorerWidget.navigationTarget.txId = txReference.split(':')[1];

            const blockFetchResult = blockExplorerWidget.getBlockDataFromMemoryOrSendRequest(blockExplorerWidget.navigationTarget.blockReference);
            if (blockFetchResult === 'request sent') { return; } // wait for block data to be fetched

            blockExplorerWidget.navigateUntilTarget(true);
            break;
        default:
            break;
    }
});
document.addEventListener('input', async (event) => {
	const isLoginForm = event.target.form.id === 'loginForm';
    if (isLoginForm) {
        const input = event.target;
        if (input.classList.contains('wrong')) { input.classList.remove('wrong'); }
    }

	const isIntensityRange = event.target.name === "intensity";
    if (isIntensityRange) {
        const rangeValue = event.target.value;
        const valueAsNumber = parseInt(rangeValue);
        document.getElementById('intensityValueStr').innerText = rangeValue;
        chrome.storage.local.set({miningIntensity: valueAsNumber});
        //console.log(`intensity set to ${rangeValue}`);
    }

    const isServerAuthBoost = event.target.id === 'serverAuthBoost';
    if (isServerAuthBoost) {
        console.log('serverAuthBoost changed');
        const label = event.target.parentElement;
        // text : Cloud security boost (min length: 6)
        //<input id="serverAuthBoost" type="checkbox" name="securityOption" value="improveSecurityUsingServer" checked>
        const newText = event.target.checked ? 'Cloud security boost (min length: 6)' : 'Cloud security boost (min length: 12)';
        const checked = event.target.checked ? 'checked' : '';
        label.innerHTML = `<input id="serverAuthBoost" type="checkbox" name="securityOption" value="improveSecurityUsingServer" ${checked}> ${newText}`;
    }

    const isPrivateKeyHexInput = event.target.id === 'privateKeyHexInput';
    if (isPrivateKeyHexInput) {
        //await new Promise(resolve => setTimeout(resolve, 0));
        console.log(`privKeyHex: ${event.target.value}`);

        if (event.target.value.length === 64) {
            eHTML.privateKeyHexInput.placeholder = event.target.value;
            eHTML.confirmPrivateKeyBtn.classList.remove('disabled');
        } else {
            eHTML.confirmPrivateKeyBtn.classList.add('disabled');
            if (event.target.value.length > 64) {
                textInfo(eHTML.createWalletForm, 'Private key too long');
            } else if (event.target.value.length < 64) {
                textInfo(eHTML.createWalletForm, 'Private key too short');
            }
        }
    }

    const amountInput = event.target.classList.contains('amountInput');
    if (amountInput) {
        event.target.value = event.target.value.replace(/[^\d.]/g, '');
        const nbOfDecimals = event.target.value.split('.')[1] ? event.target.value.split('.')[1].length : 0;
        if (nbOfDecimals > 6) { event.target.value = parseFloat(event.target.value).toFixed(6); }
    }
});
document.addEventListener('focusin', async (event) => {
    const amountInput = event.target.classList.contains('amountInput');
    if (amountInput) { event.target.value = ''; }
});
document.addEventListener('focusout', async (event) => {
    const amountInput = event.target.classList.contains('amountInput');
    if (amountInput) {
        if (isNaN(parseFloat(event.target.value))) { event.target.value = ''; return; }
        event.target.value = parseFloat(event.target.value).toFixed(6);

        const amountMicro = parseInt(event.target.value.replace('.',''));
        const formatedValue = utils.convert.number.formatNumberAsCurrency(amountMicro);
        event.target.value = formatedValue;
    }
});
document.addEventListener('mouseover', function(event) {
    if (event.target === eHTML.contrastBlocksWidget || eHTML.contrastBlocksWidget.contains(event.target)) {
        if (eHTML.contrastBlocksWidget.classList.contains('focused')) { return; }
        if (animations.contrastBlocksWidget) { animations.contrastBlocksWidget.pause(); }
        eHTML.contrastBlocksWidget.classList.add('focused');

        const computedStyle = getComputedStyle(eHTML.contrastBlocksWidget);
        eHTML.contrastBlocksWidget.style.width = computedStyle.width;
        eHTML.contrastBlocksWidget.style.boxShadow = '0px 0px 10px 0px var(--color2)';
        
        const viewWidth = window.innerWidth;
        animations.contrastBlocksWidget = anime({
            targets: eHTML.contrastBlocksWidget,
            width: `${viewWidth - 20}px`,
            boxShadow: '0px 0px 0px 2px var(--color2)',
            duration: 300,
            easing: 'easeInOutCubic'
        });
    } else {
        if (!eHTML.contrastBlocksWidget.classList.contains('focused')) { return; }
        if (animations.contrastBlocksWidget) { animations.contrastBlocksWidget.pause(); }
        eHTML.contrastBlocksWidget.classList.remove('focused');
        
        const parentWidth = eHTML.contrastBlocksWidget.parentElement.offsetWidth;
        animations.contrastBlocksWidget = anime({
            targets: eHTML.contrastBlocksWidget,
            width: `${parentWidth - 20}px`,
            boxShadow: '0px 0px 0px 0px var(--color2)',
            delay: 250,
            begin: () => {
                const computedStyle = getComputedStyle(eHTML.contrastBlocksWidget);
                eHTML.contrastBlocksWidget.style.width = computedStyle.width;
                eHTML.contrastBlocksWidget.style.boxShadow = '0px 0px 10px 0px var(--color2)';
            },
            duration: 250,
            easing: 'easeInOutCubic'
        });
    }
});
window.addEventListener('beforeunload', function(e) {
    console.log('beforeunload');
    cryptoLight.clear();
});
//#endregion

chrome.runtime.onMessage.addListener(async function(request, sender, sendResponse) {
    if (typeof request.action !== "string") { return; }
    if (!sanitizer.sanitize(request)) { console.info('data possibly corrupted!'); return; }

    let targetAccountIndex;
    let targetAccount;
    switch (request.action) {
        case 'transaction_requested':
            /** @type {TransactionWithDetails} */
            const txWithDetails = request.transactionWithDetails;
            //console.log(`[POPUP] received transaction_requested: ${JSON.stringify(txWithDetails)}`);

            fillInfoOfTxInHistory(txWithDetails);
            break;
        case 'address_exhaustive_data_requested':
            if (!activeWallet) { console.info('No active wallet'); return; }
            //data.addressUTXOs.UTXOs, data.addressTxsReferences);
            //console.log(`[POPUP] received address_exhaustive_data_requested: ${request.address}`);
            //console.log(request);
            const targetAccountAddressPrefix = request.address.slice(0, 1);
            targetAccountIndex = getWalletAccountIndexByAddress(request.address);
            if (targetAccountIndex === -1) { console.error(`No account corresponding to address: ${request.address}`); return; }
            targetAccount = activeWallet.accounts[targetAccountAddressPrefix][targetAccountIndex];
            if (!targetAccount) { console.error('No target account'); return; }

            const { balance, spendableBalance, stakedBalance, spendableUTXOs } = await extractDataFromAccountUTXOs(request.address, request.UTXOs);
            targetAccount.balance = balance;
            targetAccount.spendableBalance = spendableBalance;
            targetAccount.stakedBalance = stakedBalance;
            targetAccount.UTXOs = spendableUTXOs;

            const addressExhaustiveData = new AddressExhaustiveData(request.UTXOs, request.addressTxsReferences);
            if (!addressesExhaustiveData[request.address]) {
                addressesExhaustiveData[request.address] = addressExhaustiveData;
            } else {
                addressesExhaustiveData[request.address].mergeAddressExhaustiveData(addressExhaustiveData);
            }

            await updateTotalBalances();
            updateAccountLabel(targetAccount);

            //const explorerOpenned = !eHTML.popUpExplorer.classList.contains('hidden');
            //if (!explorerOpenned) { return; }

            fillTxHistoryWithActiveAddressData();
            break;
        case 'address_utxos_requested':
            console.log(`[POPUP] received address_utxos_requested: ${request.address}`);
            break;
        case 'transaction_broadcast_result':
            // chrome.runtime.sendMessage({action: 'transaction_broadcast_result', transaction: data.transaction, txId: data.txId, consumedAnchors: data.consumedAnchors, senderAddress: data.senderAddress, error, data.error, success: data.success});
            if (!request.success) {
                textInfo(eHTML.walletForm, `Transaction broadcast failed: ${request.error}`, 5000, true);
                console.error('Transaction broadcast failed');
                return; 
            }
            
            chrome.runtime.sendMessage({action: "get_address_exhaustive_data", address: request.senderAddress });
            textInfo(eHTML.walletForm, `Transaction sent! (id: ${request.txId})`, 5000, true);
            break;
        case 'derivedAccountResult': // DEPRECATED
            console.log('derivedAccountResult:', request.success);
            break;
        default:
            break;
    }
});

chrome.storage.onChanged.addListener(function(changes, namespace) {
    for (let key in changes) {
        if (key === 'hashRate') {
            //console.log(`hashRate changed to ${changes[key].newValue}`);
            eHTML.mining.hashRateValueStr.innerText = changes[key].newValue.toFixed(3);
        }
    }
});