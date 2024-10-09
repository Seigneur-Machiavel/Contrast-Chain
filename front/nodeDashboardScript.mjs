console.log('run/nodeDashboardScript.mjs');

// <script src="../externalLibs/anime.min.js"></script>
import { Transaction_Builder, UTXO } from '../src/transaction.mjs';
import { StakeReference } from '../src/vss.mjs';
import utils from '../src/utils.mjs';
/**
* @typedef {import("../src/block.mjs").BlockData} BlockData
* @typedef {import("./transaction.mjs").Transaction} Transaction
*/

let ws;
const WS_SETTINGS = {
    PROTOCOL: window.location.protocol === "https:" ? "wss:" : "ws:",
    DOMAIN: window.location.hostname,
    PORT: window.location.port,
    RECONNECT_INTERVAL: 5000,
    GET_NODE_INFO_INTERVAL: 2000,
}
let pingInterval;
let nodeId;
/** @type {UTXO[]} */
let validatorUTXOs = [];
let minerUTXOs = [];
let modalOpen = false;
function connectWS() {
    ws = new WebSocket(`${WS_SETTINGS.PROTOCOL}//${WS_SETTINGS.DOMAIN}:${WS_SETTINGS.PORT}`);
    console.log(`Connecting to ${WS_SETTINGS.PROTOCOL}//${WS_SETTINGS.DOMAIN}:${WS_SETTINGS.PORT}`);
  
    ws.onopen = function() {
        console.log('Connection opened');
        if (pingInterval) clearInterval(pingInterval);
        pingInterval = setInterval(() => { ws.send(JSON.stringify({ type: 'get_node_info', data: Date.now() })); }, WS_SETTINGS.GET_NODE_INFO_INTERVAL);
        ws.send(JSON.stringify({ type: 'get_node_info', data: Date.now() })); // do it once at the beginning
    };
    ws.onclose = function() {
        console.info('Connection closed');
        clearInterval(pingInterval);
        setTimeout(connectWS, WS_SETTINGS.RECONNECT_INTERVAL); // retry connection
    };
    ws.onerror = function(error) { console.info('WebSocket error: ' + error); };
  
    ws.onmessage = function(event) {
        const message = JSON.parse(event.data);
        const trigger = message.trigger;
        const data = message.data;
        if (data && data.error) { console.info(message.error); }
        switch (message.type) {
            case 'error':
                if (data === 'No active node' && !modalOpen) {
                    openModal("setup");
                    console.log('No active node, opening setup modal');
                }
                break;
            case 'node_info':
                if (data.error === 'No active node') { return; }

                displayNodeInfo(data);
                nodeId = data.nodeId;
                validatorUTXOs = data.validatorUTXOs;
                minerUTXOs = data.minerUTXOs;
                break;
            case 'node_restarting':
                console.log('node_restarting', data);
                break;
            case 'node_restarted':
                console.log('node_restarted', data);
                break;
            case 'broadcast_new_candidate':
                console.log('broadcast_new_candidate', data);
                break;
            case 'broadcast_finalized_block':
                //console.log('broadcast_finalized_block', data);
                break;
            case 'hash_rate_updated':
                if (isNaN(data)) { console.error(`hash_rate_updated: ${data} is not a number`); return; }
                eHTML.hashRate.textContent = data.toFixed(2);
                break;
            case 'balance_updated':
                if(trigger === eHTML.validatorAddress.textContent) { eHTML.validatorBalance.textContent = utils.convert.number.formatNumberAsCurrency(data); }
                if(trigger === eHTML.minerAddress.textContent) { eHTML.minerBalance.textContent = utils.convert.number.formatNumberAsCurrency(data); }
                break;
            default:
                console.error(`Unknown message type: ${message.type}`);
                break;
        }
    };
}
connectWS();

const eHTML = {
    dashboard: (nodeID) => document.getElementById(`dashboard-${nodeID}`),
    roles: document.getElementById('roles'),
    syncClock: document.getElementById('syncClock'),
    forceRestartBtn: document.getElementById('forceRestart'),
    RevalidateBtn: document.getElementById('Revalidate'),

    modals: {
		wrap: document.getElementsByClassName('modalsWrap')[0],
        modalsWrapBackground: document.getElementsByClassName('modalsWrapBackground')[0],
        setup: {
			wrap : document.getElementById('setupModalWrap'),
			modal: document.getElementById('setupModalWrap').getElementsByClassName('modal')[0],
			setupPrivateKeyForm: document.getElementById('setupPrivateKeyForm'),
			privateKeyInputWrap: document.getElementById('privateKeyInputWrap'),
            privateKeyInput: document.getElementById('privateKeyInputWrap').getElementsByTagName('input')[0],
            confirmBtn: document.getElementById('privateKeyInputWrap').getElementsByTagName('button')[0],
			//loadingSvgDiv: document.getElementById('waitingForConnectionForm').getElementsByClassName('loadingSvgDiv')[0],
		},
        validatorAddress: {
            wrap: document.getElementById('validatorAddressModalWrap'),
            modal: document.getElementById('validatorAddressModalWrap').getElementsByClassName('modal')[0],
            validatorAddressForm: document.getElementById('validatorAddressForm'),
            validatorAddressInputWrap: document.getElementById('validatorAddressInputWrap'),
            validatorAddressInput: document.getElementById('validatorAddressInputWrap').getElementsByTagName('input')[0],
            confirmBtn: document.getElementById('validatorAddressInputWrap').getElementsByTagName('button')[0],
        },
        minerAddress: {
            wrap: document.getElementById('minerAddressModalWrap'),
            modal: document.getElementById('minerAddressModalWrap').getElementsByClassName('modal')[0],
            minerAddressForm: document.getElementById('minerAddressForm'),
            minerAddressInputWrap: document.getElementById('minerAddressInputWrap'),
            minerAddressInput: document.getElementById('minerAddressInputWrap').getElementsByTagName('input')[0],
            confirmBtn: document.getElementById('minerAddressInputWrap').getElementsByTagName('button')[0],
        },
    },

    validatorAddress: document.getElementById('validatorAddress'),
    validatorRewardAddress: document.getElementById('validatorRewardAddress'),
    validatorAddressEditBtn: document.getElementById('validatorAddressEditBtn'),
    validatorHeight: document.getElementById('validatorHeight'),
    validatorBalance: document.getElementById('validatorBalance'),
    validatorStaked: document.getElementById('staked'),
    stakeInput: {
        wrap: document.getElementById('stakeInputWrap'),
        input: document.getElementById('stakeInputWrap').getElementsByTagName('input')[0],
        confirmBtn: document.getElementById('stakeInputWrap').getElementsByTagName('button')[0],
    },

    minerAddress: document.getElementById('minerAddress'),
    minerAddressEditBtn: document.getElementById('minerAddressEditBtn'),
    minerHeight: document.getElementById('minerHeight'),
    minerBalance: document.getElementById('minerBalance'),
    hashRate: document.getElementById('hashRate'),

    minerThreads: {
        wrap: document.getElementById('minerThreadsIncrementalInput'),
        input: document.getElementById('minerThreadsIncrementalInput').getElementsByTagName('input')[0],
        decrementBtn: document.getElementById('minerThreadsIncrementalInput').getElementsByTagName('button')[0],
        incrementBtn: document.getElementById('minerThreadsIncrementalInput').getElementsByTagName('button')[1],
    }
}

function displayNodeInfo(data) {
    /** @type {StakeReference[]} */
    const validatorStakesReference = data.validatorStakes ? data.validatorStakes : false;
    const validatorStaked = validatorStakesReference ? validatorStakesReference.reduce((acc, stake) => acc + stake.amount, 0) : 0;
    const validatorBalance = data.validatorBalance ? data.validatorBalance : 0;
    const minerBalance = data.minerBalance ? data.minerBalance : 0;

    eHTML.roles.textContent = data.roles.join(' - ')

    eHTML.validatorAddress.textContent = data.validatorAddress ? data.validatorAddress : '', // utils.addressUtils.formatAddress(data.validatorAddress, " ");
    eHTML.validatorRewardAddress.textContent = data.validatorRewardAddress ? data.validatorRewardAddress : '', // utils.addressUtils.formatAddress(data.validatorRewardAddress, " ");
    eHTML.validatorBalance.textContent = utils.convert.number.formatNumberAsCurrency(validatorBalance);
    eHTML.validatorHeight.textContent = data.currentHeight ? data.currentHeight : 0;
    eHTML.validatorStaked.textContent = utils.convert.number.formatNumberAsCurrency(validatorStaked);

    eHTML.minerAddress.textContent = data.minerAddress ? data.minerAddress : '',
    eHTML.minerBalance.textContent = utils.convert.number.formatNumberAsCurrency(minerBalance);
    eHTML.minerHeight.textContent = data.highestBlockIndex ? data.highestBlockIndex : 0;
    eHTML.minerThreads.input.value = data.minerThreads ? data.minerThreads : 1;
}
//#region - EVENT LISTENERS
// not 'change' event because it's triggered by the browser when the input loses focus, not when the value changes
eHTML.forceRestartBtn.addEventListener('click', () => ws.send(JSON.stringify({ type: 'force_restart', data: nodeId })));
eHTML.RevalidateBtn.addEventListener('click', () => ws.send(JSON.stringify({ type: 'force_restart_revalidate_blocks', data: nodeId })));
eHTML.syncClock.addEventListener('click', () => ws.send(JSON.stringify({ type: 'sync_clock', data: Date.now() })));
eHTML.modals.wrap.addEventListener('click', (event) => {
	if (event.target === eHTML.modals.modalsWrapBackground) { closeModal(); }
});
eHTML.modals.setup.confirmBtn.addEventListener('click', () => {
    console.log('setupPrivateKeyForm confirmBtn clicked');
    console.log('privateKeyInput value:', eHTML.modals.setup.privateKeyInput.value);
    ws.send(JSON.stringify({ type: 'set_private_key', data: eHTML.modals.setup.privateKeyInput.value }));
    closeModal();
});
eHTML.validatorAddressEditBtn.addEventListener('click', () => {
    console.log('validatorAddressEditBtn clicked');
    openModal('validatorAddress');
});
eHTML.modals.validatorAddress.confirmBtn.addEventListener('click', () => {
    console.log('validatorAddressForm confirmBtn clicked');
    console.log('validatorAddressInput value:', eHTML.modals.validatorAddress.validatorAddressInput.value);
    ws.send(JSON.stringify({ type: 'set_validator_address', data: eHTML.modals.validatorAddress.validatorAddressInput.value }));
    closeModal();
});
eHTML.minerAddressEditBtn.addEventListener('click', () => {
    console.log('minerAddressEditBtn clicked');
    openModal('minerAddress');
});
eHTML.modals.minerAddress.confirmBtn.addEventListener('click', () => {
    console.log('minerAddressForm confirmBtn clicked');
    console.log('minerAddressInput value:', eHTML.modals.minerAddress.minerAddressInput.value);
    ws.send(JSON.stringify({ type: 'set_miner_address', data: eHTML.modals.minerAddress.minerAddressInput.value }));
    closeModal();
});
document.addEventListener('submit', function(event) { event.preventDefault(); });
eHTML.stakeInput.input.addEventListener('input', () => {
    formatInputValueAsCurrency(eHTML.stakeInput.input);
    ws.send(JSON.stringify({ type: 'set_stake', data: eHTML.stakeInput.input.value }));
});
eHTML.stakeInput.confirmBtn.addEventListener('click', async () => {
    const amountToStake = parseInt(eHTML.stakeInput.input.value.replace(",","").replace(".",""));
    const validatorAddress = eHTML.validatorAddress.textContent;
    console.log(`amountToStake: ${amountToStake} | validatorAddress: ${validatorAddress}`);
    
    console.log('UTXOs', validatorUTXOs);
    const senderAccount = { address: validatorAddress, UTXOs: validatorUTXOs };
    const transaction = await Transaction_Builder.createStakingVss(senderAccount, validatorAddress, amountToStake);

    ws.send(JSON.stringify({ type: 'new_unsigned_transaction', data: transaction }));
    eHTML.stakeInput.input.value = 0;
});
eHTML.minerThreads.input.addEventListener('change', () => {
    console.log('set_miner_threads', eHTML.minerThreads.input.value);
    ws.send(JSON.stringify({ type: 'set_miner_threads', data: eHTML.minerThreads.input.value }));
});
eHTML.minerThreads.decrementBtn.addEventListener('click', () => adjustInputValue(eHTML.minerThreads.input, -1));
eHTML.minerThreads.incrementBtn.addEventListener('click', () => adjustInputValue(eHTML.minerThreads.input, 1));
//#endregion

//#region - UX FUNCTIONS
function openModal(modalName = 'setup') {
    modalOpen = true;
	const modals = eHTML.modals;
	if (!modals.wrap.classList.contains('fold')) { return; }

	modals.wrap.classList.remove('hidden');
	modals.wrap.classList.remove('fold');

	for (let modalKey in modals) {
		if (modalKey === 'wrap' || modalKey === 'modalsWrapBackground') { continue; }
		const modalWrap = modals[modalKey].wrap;
		modalWrap.classList.add('hidden');
		if (modalKey === modalName) { modalWrap.classList.remove('hidden'); }
	}

	const modalsWrap = eHTML.modals.wrap;
	modalsWrap.style.transform = 'scaleX(0) scaleY(0) skewX(0deg)';
	modalsWrap.style.opacity = 0;
	modalsWrap.style.clipPath = 'circle(6% at 50% 50%)';

	anime({
		targets: modalsWrap,
		//skewX: '1.2deg',
		scaleX: 1,
		scaleY: 1,
		opacity: 1,
		duration: 600,
		easing: 'easeOutQuad',
		complete: () => {
			if (modalName === 'setupModalWrap') { eHTML.modals.setup.privateKeyInput.focus(); }
		}
	});
	anime({
		targets: modalsWrap,
		clipPath: 'circle(100% at 50% 50%)',
		delay: 200,
		duration: 800,
		easing: 'easeOutQuad',
	});
}
function closeModal() {
    modalOpen = false;
	const modalsWrap = eHTML.modals.wrap;
	if (modalsWrap.classList.contains('fold')) { return false; }
	modalsWrap.classList.add('fold');

	anime({
		targets: modalsWrap,
		clipPath: 'circle(6% at 50% 50%)',
		duration: 600,
		easing: 'easeOutQuad',
	});
	anime({
		targets: modalsWrap,
		scaleX: 0,
		scaleY: 0,
		opacity: 0,
		duration: 800,
		easing: 'easeOutQuad',
		complete: () => {
			if (!modalsWrap.classList.contains('fold')) { return; }

			modalsWrap.classList.add('hidden');
			const modals = eHTML.modals;
			for (let modalKey in modals) {
				if (modalKey === 'wrap' || modalKey === 'modalsWrapBackground') { continue; }
				const modalWrap = modals[modalKey].wrap;
				modalWrap.classList.add('hidden');
			}
		}
	});
}
//#endregion

//#region FUNCTIONS -------------------------------------------------------
function formatInputValueAsCurrency(input) {
    const cleanedValue = input.value.replace(",","").replace(".","");
    const intValue = parseInt(cleanedValue);
    input.value = utils.convert.number.formatNumberAsCurrency(intValue);
}
function adjustInputValue(targetInput, delta, min = 1, max = 16) {
    const currentValue = parseInt(targetInput.value);
    if (delta < 0) {
        targetInput.value = Math.max(currentValue + delta, min);
    } else {
        targetInput.value = Math.min(currentValue + delta, max);
    }
    targetInput.dispatchEvent(new Event('change'));
}
//#endregion --------------------------------------------------------------