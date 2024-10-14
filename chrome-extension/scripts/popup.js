if (false) { // THIS IS FOR DEV ONLY ( to get better code completion)-
    const anime = require("./anime.min.js");
    const PatternGenerator = require("./pattern-generator.js");
	const { cryptoLight } = require("./cryptoLight.js");
    const { CenterScreenBtn, Communication, AuthInfo, Sanitizer, Miner } = require("./classes.js");
    const { htmlAnimations } = require("./htmlAnimations.js");
    const { Wallet } = require("./contrast/src/wallet.mjs");
    const utils = require("./contrast/src/utils.mjs").default;
    const { Account } = require("./contrast/src/account.mjs");
    const { Transaction, Transaction_Builder } = require("./contrast/src/transaction.mjs");
}

/**
* @typedef {import("../../src/transaction.mjs").Transaction} Transaction
* @typedef {import("../../src/transaction.mjs").UTXO} UTXO
*/

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

cryptoLight.useArgon2Worker = true; console.log('Argon2 worker enabled!');
const settings = {
    appVersion: chrome.runtime.getManifest().version,
    minVersionAcceptedWithoutReset: '1.2.0',
    hardcodedPassword: '123456',
    serverUrl: "http://localhost:4340"
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
    appTitle: document.getElementById('appTitle'),
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
        amount: document.getElementById('spendMiniForm').getElementsByTagName('input')[0],
        address: document.getElementById('spendMiniForm').getElementsByTagName('input')[1],
        confirmBtn: document.getElementById('spendMiniForm').getElementsByTagName('button')[1]
    },
    stake: {
        miniForm: document.getElementById('stakeMiniForm'),
        foldBtn: document.getElementById('stakeMiniForm').getElementsByTagName('button')[0],
        amount: document.getElementById('stakeMiniForm').getElementsByTagName('input')[0],
        address: document.getElementById('stakeMiniForm').getElementsByTagName('input')[1],
        confirmBtn: document.getElementById('stakeMiniForm').getElementsByTagName('button')[1]
    },

    bottomBar: document.getElementById('bottomBar'),
    walletBtn: document.getElementById('walletBtn'),
    miningBtn: document.getElementById('miningBtn'),
    settingsBtn: document.getElementById('settingsBtn')
};

/** @type {Wallet} */
let activeWallet;
const defaultAddressPrefix = "C";
let activeAddressPrefix = "C";
let activeAccountIndexByPrefix = { "W": 0, "C": 0 };
const busy = [];
//#region - UX FUNCTIONS
function resizePopUp(applyBLur = true, large = false, duration = 200) {
    const contentDivHeight = eHTML.popUpContent.offsetHeight;
    const contentWrapHeight = eHTML.popUpContentWrap.offsetHeight;
    const contentHeight = Math.max(contentDivHeight, contentWrapHeight);
    const newHeight = contentHeight; // + 29;
    console.log(`New height: ${newHeight}px`);
    resizePopUpAnimations = [];
    
    resizePopUpAnimations[0] = anime({
        targets: 'body',
        width: large ? '320px' : '300px',
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
async function setMiningIntensityFromLocalStorage() {
    const miningIntensity = await chrome.storage.local.get('miningIntensity');
    const intensity = miningIntensity.miningIntensity || 1;
    document.getElementsByName('intensity')[0].value = intensity;
    document.getElementById('intensityValueStr').innerText = intensity;
}
function setVisibleForm(formId, applyBLur = true) {
    eHTML.bottomBar.classList.remove('hidden');
    eHTML.popUpContent.classList.add('large');
    eHTML.appTitle.classList.add('hidden');
    eHTML.walletBtn.classList.add('active');
    eHTML.miningBtn.classList.add('active');
    eHTML.settingsBtn.classList.add('active');
    let largePopUp = true;

    centerScreenBtn.centerScreenBtnWrap.classList.remove('active');
    eHTML.centerScreenBtnContrainer.classList.add('hidden');

    const forms = document.getElementsByTagName('form');
    for (let i = 0; i < forms.length; i++) {
        if (forms[i].id === formId) { forms[i].classList.remove('hidden'); continue; }
        forms[i].classList.add('hidden');
    }

    if (formId === "passwordCreationForm" || formId === "loginForm") {
        eHTML.centerScreenBtnContrainer.classList.remove('hidden');
        eHTML.bottomBar.classList.add('hidden');
        eHTML.appTitle.classList.remove('hidden');
        eHTML.popUpContent.classList.remove('large');
        largePopUp = false;
    }

    if (formId === "walletForm") {
        eHTML.walletBtn.classList.remove('active');
    }
    if (formId === "createWalletForm") {
        eHTML.miningBtn.classList.remove('active');
        eHTML.settingsBtn.classList.remove('active');
        eHTML.bottomBar.classList.add('hidden');
        eHTML.popUpContent.classList.remove('large');
        largePopUp = false;
    }

    if (formId === "miningForm") {
        eHTML.centerScreenBtnContrainer.classList.remove('hidden');
        centerScreenBtn.centerScreenBtnWrap.classList.add('active');
        eHTML.miningBtn.classList.remove('active');
        setTimeout(async () => { setMiningIntensityFromLocalStorage() }, 100);
    }

    if (formId === "settingsForm") {
        eHTML.settingsBtn.classList.remove('active');
    }

    resizePopUp(applyBLur, largePopUp);
}
function toggleMiniForm(miniFormElmnt) {
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
function bottomInfo(targetForm, text, timeout = 3000) {
    const infoElmnt = targetForm.getElementsByClassName('bottomInfo')[0];
    infoElmnt.innerText = text;

    setTimeout(() => {
        infoElmnt.innerText = "";
    }, timeout);

    /*const infoElmnts = targetForm.getElementsByClassName('bottomInfo');
    for (const infoElmnt of infoElmnts) { infoElmnt.innerText = text; }
    
	setTimeout(() => {
        for (const infoElmnt of infoElmnts) { infoElmnt.innerText = ""; }
	}, timeout);*/
}
function setWaitingForConnectionFormLoading(loading = true) {
    const waitingForConnectionForm = document.getElementById('waitingForConnectionForm');
    const loadingSvg = waitingForConnectionForm.getElementsByClassName('loadingSvgDiv')[0];
    loadingSvg.innerHTML = loading ? htmlAnimations.horizontalBtnLoading : '';
}
function initUI() {
    document.body.style.width = "0px";
    document.body.style.height = "0px";
}
/*<div class="accountLabel">
    <img src="../images/qr-code32.png" alt="Account">
    <div class="accountLabelInfoWrap">
        <div class="accountLabelNameAndValueWrap">
            <h2>Account 1</h2>
            <h3>0.00c</h3>
        </div>
        <div class="accountLabelAddress">
            <h3>WKDEJFIUHESVUOHEIUEF</h3>
        </div>
    </div>
</div>*/
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
async function updateBalances() {
    let walletTotalBalance = 0;
    let walletTotalSpendableBalance = 0;
    let walletTotalStakedBalance = 0;
    // for each address type
    const addressTypes = Object.keys(activeWallet.accounts);
    for (let i = 0; i < addressTypes.length; i++) {
        const addressPrefix = addressTypes[i];
        const showInLabelsWrap = addressPrefix === activeAddressPrefix;
        const { totalBalance, totalSpendableBalance, totalStakedBalance } = updateLabelsBalances(addressPrefix, showInLabelsWrap);
        walletTotalBalance += totalBalance;
        walletTotalSpendableBalance += totalSpendableBalance;
        walletTotalStakedBalance += totalStakedBalance;
    }

    eHTML.spendableBalanceStr.innerText = utils.convert.number.formatNumberAsCurrency(walletTotalBalance);
    eHTML.stakedStr.innerText = utils.convert.number.formatNumberAsCurrency(walletTotalStakedBalance);

    updateActiveAccountLabel();

    //console.log(`[POPUP] wallet accounts updated: ${activeWallet.accounts[activeAddressPrefix].length}`);
}
function updateLabelsBalances(addressPrefix = defaultAddressPrefix, showInLabelsWrap = false) {
    if (showInLabelsWrap) { eHTML.accountsWrap.innerHTML = ''; }

    let totalBalance = 0;
    let totalSpendableBalance = 0;
    let totalStakedBalance = 0;
    const nbOfAccounts = activeWallet.accounts[addressPrefix].length;
    for (let i = 0; i < nbOfAccounts; i++) {
        const account = activeWallet.accounts[addressPrefix][i];
        totalBalance += account.balance;
        totalSpendableBalance += account.spendableBalance;
        totalStakedBalance += account.stakedBalance || 0;
        if (!showInLabelsWrap) { continue; }

        const accountName = `Account ${i + 1}`;
        const accountLabel = createAccountLabel(accountName, account.address, account.spendableBalance);
        eHTML.accountsWrap.appendChild(accountLabel);
    }

    return { totalBalance, totalSpendableBalance, totalStakedBalance };
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
function newAddressBtnLoadingToggle() {
    const isGenerating = eHTML.newAddressBtn.innerHTML !== '+';

    if (isGenerating) {
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
        eHTML.newAddressBtn.innerHTML = htmlAnimations.horizontalBtnLoading;
        if (animations.newAddressBtn) { animations.newAddressBtn.pause(); }
        animations.newAddressBtn = anime({
            targets: eHTML.newAddressBtn,
            width: ['60px', '200px', '60px'],
            duration: 1600,
            loop: true,
            easing: 'easeInOutQuad'
        });
    }
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

    /*if (!vaultState || !vaultState.vaultUnlocked) {
        await initAuth();
    } else {
        const connectionResult = await pingServerAndSetMode();
        if (!connectionResult) { return; }

        setVisibleForm('miningForm');

        miner.init();
        centerScreenBtn.delayBeforeIdleAnimationIfLocked = 1;

        const bottomBar = document.getElementById('bottomBar');
        bottomBar.classList.remove('hidden');
    }*/
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
    await chrome.storage.local.clear(function() {
        var error = chrome.runtime.lastError;
        if (error) {
            console.error(error);
        } else {
            console.log('Application reset');
            setVisibleForm('passwordCreationForm');
            eHTML.passwordCreationFormInputPassword.focus();
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

    if (!walletInfo.accountsGenerated) { walletInfo.accountsGenerated = { "W": [], "C": [] }; }
    const nbOfExistingAccounts = walletInfo.accountsGenerated[activeAddressPrefix].length;
    /** @type {Account[]} */
    const derivedAccounts = await activeWallet.deriveAccounts(nbOfExistingAccounts, activeAddressPrefix);
    if (!derivedAccounts) { console.error('Derivation failed'); return; }

    const nbOfAccounts = activeWallet.accounts[activeAddressPrefix].length;
    for (let i = 0; i < nbOfAccounts; i++) {
        const account = activeWallet.accounts[activeAddressPrefix][i];
        const accountName = `Account ${i + 1}`;
        const accountLabel = createAccountLabel(accountName, account.address, account.balance);
        eHTML.accountsWrap.appendChild(accountLabel);
    }

    console.log(`[POPUP] wallet accounts loaded: ${nbOfAccounts}`);
}
async function addPendingAnchorsRelatedToAddress(address, anchors = []) {
    const loadedPendingAnchors = await chrome.storage.local.get('pendingAnchorsByAddresses');
    const pendingAnchorsByAddresses = loadedPendingAnchors.pendingAnchorsByAddresses || {};
    if (!pendingAnchorsByAddresses[address]) { pendingAnchorsByAddresses[address] = []; }

    pendingAnchorsByAddresses[address].push(...anchors);
    await chrome.storage.local.set({ pendingAnchorsByAddresses });
}
async function getAllPendingAnchorsRelatedToAddress(address) {
    const pendingAnchors = [];
    const loadedPendingAnchors = await chrome.storage.local.get('pendingAnchorsByAddresses');
    if (!loadedPendingAnchors || !loadedPendingAnchors.pendingAnchorsByAddresses) { return pendingAnchors; }

    const pendingAnchorsByAddresses = loadedPendingAnchors.pendingAnchorsByAddresses;
    if (!pendingAnchorsByAddresses[address]) { return pendingAnchors; }
    for (const anchors of pendingAnchorsByAddresses[address]) {
        pendingAnchors.push(anchors);
    }

    return pendingAnchors;
}
async function removePendingAnchorsRelatedToAddress(address, anchors = []) {
    const loadedPendingAnchors = await chrome.storage.local.get('pendingAnchorsByAddresses');
    if (!loadedPendingAnchors || !loadedPendingAnchors.pendingAnchorsByAddresses) { console.error('No pending anchors'); return; }

    const pendingAnchorsByAddresses = loadedPendingAnchors.pendingAnchorsByAddresses;
    if (!pendingAnchorsByAddresses[address]) { console.error('Address has no pending anchors'); return; }

    const pendingAnchors = pendingAnchorsByAddresses[address];
    for (const anchor of anchors) {
        const index = pendingAnchors.indexOf(anchor);
        if (index === -1) { console.error('Anchor not pending'); continue; }
        pendingAnchors.splice(index, 1);
    }

    await chrome.storage.local.set({ pendingAnchorsByAddresses });
}
async function setPendingAnchorsRelatedToAddress(address, anchors = []) {
    const loadedPendingAnchors = await chrome.storage.local.get('pendingAnchorsByAddresses');
    const pendingAnchorsByAddresses = loadedPendingAnchors.pendingAnchorsByAddresses || {};
    pendingAnchorsByAddresses[address] = anchors;
    await chrome.storage.local.set({ pendingAnchorsByAddresses });
}
/** @param {UTXO[]} utxos */
async function extractDataFromAccountUTXOs(address, utxos) {
    let balance = 0;
    let spendableBalance = 0;
    let stakedBalance = 0;
    const spendableUTXOs = [];

    const pendingAnchors = await getAllPendingAnchorsRelatedToAddress(address); // pending anchors
    const updatedPendingAnchors = [];
    for (const utxo of utxos) {
        balance += utxo.amount;
        //if (address === 'WYnwjFkgumbp3jBCUoz5') console.log(`utxo: ${utxo.amount} ${utxo.rule} ${utxo.anchor}`);
        if (utxo.rule === 'sigOrSlash') { stakedBalance += utxo.amount; continue; }
        if (pendingAnchors.includes(utxo.anchor)) { updatedPendingAnchors.push(utxo.anchor); continue; }
        spendableUTXOs.push(utxo);
        spendableBalance += utxo.amount;
    }
    await setPendingAnchorsRelatedToAddress(address, updatedPendingAnchors);

    return { balance, spendableBalance, stakedBalance, spendableUTXOs };
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

    function infoAndWrongAnim(text) {
		bottomInfo(targetForm, text);
		input.classList.add('wrong');
        cryptoLight.clear();
        button.innerHTML = 'Unlock';
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
    if (!res) { infoAndWrongAnim('Key derivation failed'); busy.splice(busy.indexOf('loginForm'), 1); return; }
    
    //cryptoLight.clear(); // needed to sign tx, will be clear on close
    button.innerHTML = 'Unlock';

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
    await loadWalletGeneratedAccounts(walletInfo);
    
    chrome.runtime.sendMessage({action: 'authentified', password: passwordReadyUse });
    if (activeWallet.accounts[activeAddressPrefix][0]) {
        for (let i = 0; i < activeWallet.accounts[activeAddressPrefix].length; i++) {
            const address = activeWallet.accounts[activeAddressPrefix][i].address;
            chrome.runtime.sendMessage({action: "get_address_exhaustive_data", address });
            chrome.runtime.sendMessage({action: "subscribe_balance_update", address });
        }
    }

    setVisibleForm('walletForm');

    passwordReadyUse = null;
    busy.splice(busy.indexOf('loginForm'), 1);
});

document.addEventListener('mouseup', function(e) { // release click
    switch (e.target.className) {
        case 'sendBtn':
            if (animations.sendBtn) { animations.sendBtn.pause(); }
            animations.sendBtn = anime({
                targets: e.target,
                background: 'linear-gradient(90deg, white 0%, transparent 0%)',
                duration: 1000,
                easing: 'easeInOutQuad',
                complete: () => {
                    e.target.style.background = 'white';
                }
            });
            break;
        case 'stakeBtn':
            if (animations.stakeBtn) { animations.stakeBtn.pause(); }
            animations.stakeBtn = anime({
                targets: e.target,
                background: 'linear-gradient(90deg, white 0%, transparent 0%)',
                duration: 1000,
                easing: 'easeInOutQuad',
                complete: () => {
                    e.target.style.background = 'white';
                }
            });
            break;
        default:
            break;
    }
});
document.addEventListener('mousedown', function(e) { // hold click
    switch (e.target.className) {
        case 'sendBtn':
            if (eHTML.send.address.value === '') { bottomInfo(eHTML.send.miniForm, 'Address is empty'); return; }
            if (eHTML.send.amount.value === '') { bottomInfo(eHTML.send.miniForm, 'Amount is empty'); return; }
            if (animations.sendBtn) { animations.sendBtn.pause(); }
            e.target.style.background = 'linear-gradient(90deg, white 0%, transparent 0%)';
            animations.sendBtn = anime({
                targets: e.target,
                background: 'linear-gradient(90deg, white 100%, transparent 110%)',
                duration: 1000,
                easing: 'easeInOutQuad',
                complete: async () => {
                    console.log('sendBtn');
                    amount = parseInt(eHTML.send.amount.value.replace(",","").replace(".",""));
                    console.log('amount:', amount);
                    // utils.addressUtils.conformityCheck(eHTML.send.address.value);
                    receiverAddress = eHTML.send.address.value;
                    senderAccount = activeWallet.accounts[activeAddressPrefix][activeAccountIndexByPrefix[activeAddressPrefix]];
                    const createdSignedTx = await Transaction_Builder.createAndSignTransfer(senderAccount, amount, receiverAddress);
                    if (!createdSignedTx.signedTx) {
                        console.error('Transaction creation failed', createdSignedTx.error);
                        bottomInfo(eHTML.send.miniForm, createdSignedTx.error);
                        return;
                    }
                    
                    console.log('transaction:', createdSignedTx.signedTx);
                    chrome.runtime.sendMessage({action: "broadcast_transaction", transaction: createdSignedTx.signedTx, senderAddress: senderAccount.address });
                    e.target.style.background = 'white';
                }
            });
            break;
        case 'stakeBtn':
            if (eHTML.stake.amount.value === '') { bottomInfo(eHTML.stake.miniForm, 'Amount is empty'); return; }
            if (animations.stakeBtn) { animations.stakeBtn.pause(); }
            e.target.style.background = 'linear-gradient(90deg, white 0%, transparent 0%)';
            animations.stakeBtn = anime({
                targets: e.target,
                background: 'linear-gradient(90deg, white 100%, transparent 110%)',
                duration: 1000,
                easing: 'easeInOutQuad',
                complete: async () => {
                    console.log('stakeBtn');
                    amount = parseInt(eHTML.stake.amount.value.replace(",","").replace(".",""));
                    console.log('amount:', amount);
        
                    senderAccount = activeWallet.accounts[activeAddressPrefix][activeAccountIndexByPrefix[activeAddressPrefix]];
                    createdTx = await Transaction_Builder.createStakingVss(senderAccount, senderAccount.address, amount);
                    if (!createdTx) {
                        console.error('Transaction creation failed');
                        bottomInfo(eHTML.stake.miniForm, 'Transaction creation failed');
                        return;
                    }
        
                    signedTx = await senderAccount.signTransaction(createdTx);
                    if (!signedTx) {
                        console.error('Transaction signing failed');
                        bottomInfo(eHTML.stake.miniForm, 'Transaction signing failed');
                        return;
                    }
        
                    console.log('transaction:', signedTx);
                    chrome.runtime.sendMessage({action: "broadcast_transaction", transaction: signedTx, senderAddress: senderAccount.address });
                    e.target.style.background = 'white';
                }
            });
            break;
        default:
            break;
    }
});
document.addEventListener('click', async function(e) {
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
    switch (e.target.id) {
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
            bottomInfo(eHTML.createWalletForm, 'Private key copied to clipboard');
            break;
        case 'confirmPrivateKeyBtn':
            encryptedSeedHex = await cryptoLight.encryptText(eHTML.privateKeyHexInput.placeholder);
            activeWallet = new Wallet(eHTML.privateKeyHexInput.placeholder);
            eHTML.privateKeyHexInput.placeholder = 'Private key';
            walletInfo = new WalletInfo({name: 'wallet1', encryptedSeedHex: encryptedSeedHex});
            loadedWalletsInfo = await chrome.storage.local.get('walletsInfo');
            walletsInfo = loadedWalletsInfo && loadedWalletsInfo.walletsInf ? loadedWalletsInfo.walletsInfo : [];
            walletsInfo.push(walletInfo.extractVarsObjectToSave());

            await chrome.storage.local.set({walletsInfo});
            setVisibleForm('walletForm');
            console.log('Private key set');
            break;
        case 'walletBtn':
            if (!e.target.classList.contains('active')) { return; }
            setVisibleForm('walletForm', false);
            break;
        case 'newAddressBtn':
            console.log('newAddressBtn');
            if (e.target.innerHTML !== '+') { console.log('Already generating new address'); return; }
            privateKeyHex = await getWalletPrivateKey(selectedWalletIndex);

            newAddressBtnLoadingToggle();
            console.log('privateKeyHex:', privateKeyHex);
            const nbOfExistingAccounts = activeWallet.accounts[activeAddressPrefix].length;
            const derivedAccounts = await activeWallet.deriveAccounts(nbOfExistingAccounts + 1, activeAddressPrefix);
            newAddressBtnLoadingToggle();
            if (!derivedAccounts) { console.error('Derivation failed'); return; }

            await saveWalletGeneratedAccounts(selectedWalletIndex);
            console.log('[POPUP] wallet accounts generated and saved');

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
            if (!e.target.classList.contains('active')) { return; }
            setVisibleForm('miningForm', false);
            break;
        case 'settingsBtn':
            if (!e.target.classList.contains('active')) { return; }
            setVisibleForm('settingsForm', false);
            break;
        default:
            //console.log(`clicked: ${e.target.id}`);
            break;
    }

    switch (e.target.className) {
        case 'accountImgWrap':
            //console.log('accountImgWrap clicked');
            const accountLabel = e.target.parentElement;
            const accountIndex = Array.from(accountLabel.parentElement.children).indexOf(accountLabel);

            //console.log(`accountIndex: ${accountIndex}`);
            activeAccountIndexByPrefix[activeAddressPrefix] = accountIndex;
            updateActiveAccountLabel();
            break;
        /*case 'btnBackground':
            console.log(`btnBackground, clicking parent: ${e.target.parentElement.id}`);
            e.target.parentElement.click();
            break;*/
        case 'foldBtn':
            console.log('foldBtn');
            toggleMiniForm(e.target.parentElement);
            break;
        /*case 'sendBtn': -> MOVED TO HOLD BUTTON LISTENER
            console.log('sendBtn');
            amount = parseInt(eHTML.send.amount.value.replace(",","").replace(".",""));
            console.log('amount:', amount);
            // utils.addressUtils.conformityCheck(eHTML.send.address.value);
            receiverAddress = eHTML.send.address.value;
            senderAccount = activeWallet.accounts[activeAddressPrefix][activeAccountIndexByPrefix[activeAddressPrefix]];
            const createdSignedTx = await Transaction_Builder.createAndSignTransfer(senderAccount, amount, receiverAddress);
            if (!createdSignedTx.signedTx) { console.error('Transaction creation failed', createdSignedTx.error); return; }
            
            console.log('transaction:', createdSignedTx.signedTx);
            chrome.runtime.sendMessage({action: "broadcast_transaction", transaction: createdSignedTx.signedTx, senderAddress: senderAccount.address });
            break;
        case 'stakeBtn':
            console.log('stakeBtn');
            amount = parseInt(eHTML.stake.amount.value.replace(",","").replace(".",""));
            console.log('amount:', amount);

            senderAccount = activeWallet.accounts[activeAddressPrefix][activeAccountIndexByPrefix[activeAddressPrefix]];
            createdTx = await Transaction_Builder.createStakingVss(senderAccount, senderAccount.address, amount);
            if (!createdTx) { console.error('Transaction creation failed'); return; }

            signedTx = await senderAccount.signTransaction(createdTx);
            if (!signedTx) { console.error('Transaction signing failed'); return; }

            console.log('transaction:', signedTx);
            chrome.runtime.sendMessage({action: "broadcast_transaction", transaction: signedTx, senderAddress: senderAccount.address });
            break;*/
        default:
            break;
    }
});
document.addEventListener('input', (event) => {
	const isLoginForm = event.target.form.id === 'loginForm';
    if (isLoginForm) {
        const input = event.target;
        if (input.classList.contains('wrong')) { input.classList.remove('wrong'); }
    }

	const isIntensityRange = event.target.name === "intensity";
    if (isIntensityRange) {
        const rangeValue = event.target.value;
        const valueAsNumber = parseInt(rangeValue);
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
        console.log(`privKeyHex: ${event.target.value}`);
        if (event.target.value.length === 64) {
            eHTML.privateKeyHexInput.placeholder = event.target.value;
            eHTML.confirmPrivateKeyBtn.classList.remove('disabled');
        } else {
            eHTML.confirmPrivateKeyBtn.classList.add('disabled');
        }
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
        case 'address_exhaustive_data_requested':
            //data.addressUTXOs.UTXOs, data.addressTxsReferences);
            //console.log(`[POPUP] received address_exhaustive_data_requested: ${request.address}`);
            
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

            updateBalances();
            break;
        case 'address_utxos_requested':
            console.log(`[POPUP] received address_utxos_requested: ${request.address}`);
            break;
        case 'transaction_broadcast_result':
            // chrome.runtime.sendMessage({action: 'transaction_broadcast_result', txId: data.txId, consumedAnchors: data.consumedAnchors, senderAddress: data.senderAddress, error, data.error, success: data.success});
            if (!request.success) {
                bottomInfo(eHTML.walletForm, `Transaction broadcast failed: ${request.error}`);
                console.error('Transaction broadcast failed');
                return; 
            }
            await addPendingAnchorsRelatedToAddress(request.senderAddress, request.consumedAnchors);

            chrome.runtime.sendMessage({action: "get_address_exhaustive_data", address: request.senderAddress });
            bottomInfo(eHTML.walletForm, `Transaction sent, ID: ${request.txId}`, 5000);
            break;
        case 'derivedAccountResult': // DEPRECATED
            console.log('derivedAccountResult:', request.success);
            break;
        default:
            break;
    }
});