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
                //console.log('balance_updated', data);
                return; // not used anymore, we fetch node_info frequently
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
            confirmBtn: document.getElementById('privateKeyInputWrap').getElementsByTagName('button')[1],
            togglePrivateKeyBtn: document.getElementById('togglePrivateKey'),
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
        resetInfoModal: {
            wrap: document.getElementById('resetInfoModalWrap'),
            modal: document.getElementById('resetInfoModalWrap').getElementsByClassName('modal')[0],
            confirmBtn: document.getElementById('confirmResetBtn'),
            cancelBtn: document.getElementById('cancelResetBtn'),
        }
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
    },
    peersConnected: document.getElementById('peersConnected'),
    lastBlockInfo: document.getElementById('lastBlockInfo'),
    txInMempool: document.getElementById('txInMempool'),
    averageBlockTime: document.getElementById('averageBlockTime'),
    adminPanelButtons: document.querySelector('#topBar .btnWrap'),
    resetInfoBtn: document.getElementById('resetInfo'),
    toggleAdminPanelBtn : document.getElementById('toggleAdminPanel'),

    resetInfoBtn: document.getElementById('resetInfo'),

}

function displayNodeInfo(data) {
    /** @type {StakeReference[]} */
    const validatorStakesReference = data.validatorStakes ? data.validatorStakes : false;
    const validatorStaked = validatorStakesReference ? validatorStakesReference.reduce((acc, stake) => acc + stake.amount, 0) : 0;
    const validatorBalance = data.validatorBalance ? data.validatorBalance : 0;
    const minerBalance = data.minerBalance ? data.minerBalance : 0;

    // Update roles
    eHTML.roles.textContent = data.roles.join(' - ');

    // Update Validator information
    eHTML.validatorAddress.textContent = data.validatorAddress ? data.validatorAddress : ''; 
    eHTML.validatorRewardAddress.textContent = data.validatorRewardAddress ? data.validatorRewardAddress : '';
    eHTML.validatorBalance.textContent = utils.convert.number.formatNumberAsCurrency(validatorBalance);
    eHTML.validatorHeight.textContent = data.currentHeight ? data.currentHeight : 0;
    eHTML.validatorStaked.textContent = utils.convert.number.formatNumberAsCurrency(validatorStaked);

    // Update Miner information
    eHTML.minerAddress.textContent = data.minerAddress ? data.minerAddress : '';
    eHTML.minerBalance.textContent = utils.convert.number.formatNumberAsCurrency(minerBalance);
    eHTML.minerHeight.textContent = data.highestBlockIndex ? data.highestBlockIndex : 0;
    eHTML.minerThreads.input.value = data.minerThreads ? data.minerThreads : 1;
    eHTML.hashRate.textContent = data.minerHashRate ? data.minerHashRate.toFixed(2) : 0;

    // Update Global Information
    eHTML.peersConnected.textContent = data.peersConnected ? data.peersConnected : 0;
    eHTML.lastBlockInfo.textContent = data.lastBlockInfo ? data.lastBlockInfo : 'No Block Info';
    eHTML.txInMempool.textContent = data.txInMempool ? data.txInMempool : 0;
    eHTML.averageBlockTime.textContent = data.averageBlockTime ? `${data.averageBlockTime} seconds` : '0 seconds';
}

//#region - EVENT LISTENERS
// not 'change' event because it's triggered by the browser when the input loses focus, not when the value changes
eHTML.forceRestartBtn.addEventListener('click', () => ws.send(JSON.stringify({ type: 'force_restart', data: nodeId })));
eHTML.RevalidateBtn.addEventListener('click', () => ws.send(JSON.stringify({ type: 'force_restart_revalidate_blocks', data: nodeId })));
eHTML.modals.wrap.addEventListener('click', (event) => {
	if (event.target === eHTML.modals.modalsWrapBackground) { closeModal(); }
});
eHTML.modals.setup.confirmBtn.addEventListener('click', () => {
    console.log('setupPrivateKeyForm confirmBtn clicked');
    console.log('privateKeyInput value:', eHTML.modals.setup.privateKeyInput.value);
    ws.send(JSON.stringify({ type: 'set_private_key', data: eHTML.modals.setup.privateKeyInput.value }));
    closeModal();
});
eHTML.modals.setup.togglePrivateKeyBtn.addEventListener('click', () => {
    if (eHTML.modals.setup.privateKeyInput.type === 'password') {
        eHTML.modals.setup.privateKeyInput.type = 'text';
        eHTML.modals.setup.togglePrivateKeyBtn.textContent = 'Hide';
    } else {
        eHTML.modals.setup.privateKeyInput.type = 'password';
        eHTML.modals.setup.togglePrivateKeyBtn.textContent = 'Show';
    }
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
document.addEventListener('input', async (event) => {
    const amountInput = event.target.classList.contains('amountInput');
    if (amountInput) {
        console.log('amountInput input');
        event.target.value = event.target.value.replace(/[^\d.]/g, '');
        const nbOfDecimals = event.target.value.split('.')[1] ? event.target.value.split('.')[1].length : 0;
        if (nbOfDecimals > 6) { event.target.value = parseFloat(event.target.value).toFixed(6); }
    }
});
document.addEventListener('focusout', async (event) => {
    const amountInput = event.target.classList.contains('amountInput');
    if (amountInput) {
        console.log('amountInput focusout');
        if (isNaN(parseFloat(event.target.value))) { event.target.value = ''; return; }
        event.target.value = parseFloat(event.target.value).toFixed(6);

        const amountMicro = parseInt(event.target.value.replace('.',''));
        const formatedValue = utils.convert.number.formatNumberAsCurrency(amountMicro);
        event.target.value = formatedValue;
    }
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

eHTML.toggleAdminPanelBtn.addEventListener('click', toggleAdminPanel);

function toggleAdminPanel() {
    const isHidden = eHTML.adminPanelButtons.classList.contains('hidden');

    if (isHidden) {
        // Show the panel
        console.log('toggleAdminPanelBtn clicked - Show');
        eHTML.adminPanelButtons.classList.remove('hidden');
        eHTML.adminPanelButtons.style.maxHeight = '0px';
        anime({
            targets: eHTML.adminPanelButtons,
            maxHeight: ['0px', '200px'], // adjust as needed
            duration: 3000,
            easing: 'easeOutQuart',
            begin: () => {
                eHTML.toggleAdminPanelBtn.textContent = 'Hide Admin Panel';
            }
        });
    } else {
        // Hide the panel
        console.log('toggleAdminPanelBtn clicked - Hide');
        anime({
            targets: eHTML.adminPanelButtons,
            maxHeight: ['200px', '0px'], // adjust as needed
            duration: 1000,
            easing: 'easeOutQuart',
            complete: () => {
                eHTML.adminPanelButtons.classList.add('hidden');
                eHTML.adminPanelButtons.style.maxHeight = '0px';
                eHTML.toggleAdminPanelBtn.textContent = 'Show Admin Panel';
            }
        });
    }
}

eHTML.toggleAdminPanelBtn.addEventListener('click', toggleAdminPanel);

eHTML.resetInfoBtn.addEventListener('click', () => {
    openModal('resetInfo');
});

eHTML.modals.resetInfoModal.confirmBtn.addEventListener('click', () => {
    performResetInfo(); // Function to perform the reset action
    closeModal();
});

eHTML.modals.resetInfoModal.cancelBtn.addEventListener('click', () => {
    closeModal();
});

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
        scaleX: 1,
        scaleY: 1,
        opacity: 1,
        duration: 600,
        easing: 'easeOutQuad',
        complete: () => {
            if (modalName === 'setup') { eHTML.modals.setup.privateKeyInput.focus(); }
            if (modalName === 'resetInfo') { eHTML.modals.resetInfoModal.confirmBtn.focus(); }
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
    if (isNaN(intValue)) { input.value = ''; return; }
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