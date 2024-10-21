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

let nodeId;
/** @type {UTXO[]} */
let validatorUTXOs = [];
let minerUTXOs = [];
let modalOpen = false;
let currentAction = null;

const ACTIONS = {
    HARD_RESET: 'hard_reset',
    UPDATE_GIT: 'update_git',
    FORCE_RESTART: 'force_restart',
    REVALIDATE: 'revalidate',
    RESET_WALLET: 'reset_wallet',
    SETUP: 'setup',
    SET_VALIDATOR_ADDRESS: 'set_validator_address',
    SET_MINER_ADDRESS: 'set_miner_address'
};


function connectWS() {
    ws = new WebSocket(`${WS_SETTINGS.PROTOCOL}//${WS_SETTINGS.DOMAIN}:${WS_SETTINGS.PORT}`);
    //console.log(`Connecting to ${WS_SETTINGS.PROTOCOL}//${WS_SETTINGS.DOMAIN}:${WS_SETTINGS.PORT}`);
  
    ws.onopen = function() {
        console.log('Connection opened');
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
                    openModal(ACTIONS.SETUP, {
                        message: 'No active node detected. Please set up your private key.',
                        inputLabel: 'Private Key:',
                        inputType: 'password',
                        showInput: true,
                        showToggle: true
                    });
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

async function getGetNodeInfoLoop() {
    while (true) {
        await new Promise((resolve) => { setTimeout(() => { resolve(); }, WS_SETTINGS.GET_NODE_INFO_INTERVAL); });
        if (!ws || ws.readyState !== 1) { continue; }
        try { ws.send(JSON.stringify({ type: 'get_node_info', data: Date.now() })) } catch (error) {};
    }
}; 
getGetNodeInfoLoop();
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
        unifiedModal: {
            wrap: document.getElementById('unifiedModalWrap'),
            modal: document.getElementById('unifiedModalWrap').getElementsByClassName('modal')[0],
            form: document.getElementById('unifiedModalForm'),
            message: document.getElementById('modalMessage'),
            inputSection: document.getElementById('modalInputSection'),
            inputLabel: document.getElementById('modalInputLabel'),
            input: document.getElementById('modalInput'),
            toggleInputBtn: document.getElementById('toggleModalInput'),
            confirmBtn: document.getElementById('modalConfirmBtn'),
            cancelBtn: document.getElementById('modalCancelBtn'),
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
    minerRewardAddress: document.getElementById('minerRewardAddress'), // Assuming this exists if needed
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
    toggleAdminPanelBtn : document.getElementById('toggleAdminPanel'),

    resetInfoBtn: document.getElementById('resetInfo'),
    peerId: document.getElementById('peerId'),
    peersConnectedList: document.getElementById('peersConnectedList'),
    hardResetBtn: document.getElementById('hardReset'),
    updateGitBtn: document.getElementById('updateGit'),
    nodeState: document.getElementById('nodeState'),
    repScoresList: document.getElementById('repScoreList'),
}

// Function to display node information
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
    eHTML.peerId.textContent = data.peerId ? data.peerId : 'No Peer ID';
    eHTML.nodeState.textContent = data.nodeState ? data.nodeState : 'No State';
    if (Array.isArray(data.peerIds)) {
        renderPeers(data.peerIds);
    } else {
        console.warn('peerIds is not an array:', data.peerIds);
        eHTML.peersConnectedList.innerHTML = '<li>No peers available.</li>';
    }

    if (data.repScores) {
        renderScores(data.repScores);
    }
}

function renderPeers(peers) {
    eHTML.peersConnectedList.innerHTML = ''; // Clear existing list

    if (peers.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'No peers connected.';
        eHTML.peersConnectedList.appendChild(li);
        return;
    }

    peers.forEach(peerId => {
        const li = document.createElement('li');
        li.classList.add('peer-item'); // Optional: Add a class for styling

        // Create a span to hold the peer ID
        const peerSpan = document.createElement('span');
        peerSpan.textContent = peerId;
        peerSpan.classList.add('peer-id'); // Optional: Add a class for styling

        // Create Disconnect Button
        const disconnectBtn = document.createElement('button');
        disconnectBtn.textContent = 'Disconnect';
        disconnectBtn.classList.add('disconnect-btn'); // Add class for styling
        disconnectBtn.dataset.peerId = peerId; // Store peerId for reference

        // Create Ask Sync Button
        const askSyncBtn = document.createElement('button');
        askSyncBtn.textContent = 'Ask Sync';
        askSyncBtn.classList.add('ask-sync-btn'); // Add class for styling
        askSyncBtn.dataset.peerId = peerId; // Store peerId for reference

        // Append elements to the list item
        li.appendChild(peerSpan);
        li.appendChild(disconnectBtn);
        li.appendChild(askSyncBtn);

        eHTML.peersConnectedList.appendChild(li);
    });
}


function renderScores(scores) {
    eHTML.repScoresList.innerHTML = ''; // Clear existing list

    if (scores.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'No reputation scores available.';
        eHTML.repScoresList.appendChild(li);
        return;
    }

    scores.forEach(score => {
        const li = document.createElement('li');
        li.textContent = score.identifier + ': ' + score.score;
        eHTML.repScoresList.appendChild(li);
    });
}

// Event listeners for modals
eHTML.modals.wrap.addEventListener('click', (event) => {
    if (event.target === eHTML.modals.modalsWrapBackground) { closeModal(); }
});

// Unified modal confirm button
eHTML.modals.unifiedModal.confirmBtn.addEventListener('click', () => {
    console.log('Confirm button clicked with action:', currentAction);
    switch (currentAction) {
        case ACTIONS.SETUP:
            console.log('Setup: setting private key');
            const setupPrivKey = eHTML.modals.unifiedModal.input.value.trim();
            if (!setupPrivKey) {
                alert('Private key is required for setup.');
                return;
            }
            ws.send(JSON.stringify({ type: 'set_private_key', data: setupPrivKey }));
            break;
        case ACTIONS.SET_VALIDATOR_ADDRESS:
            console.log('Set Validator Address:', eHTML.modals.unifiedModal.input.value.trim());
            const newValidatorAddress = eHTML.modals.unifiedModal.input.value.trim();
            if (!newValidatorAddress) {
                alert('Validator address cannot be empty.');
                return;
            }
            ws.send(JSON.stringify({ type: 'set_validator_address', data: newValidatorAddress }));
            break;
        case ACTIONS.SET_MINER_ADDRESS:
            console.log('Set Miner Address:', eHTML.modals.unifiedModal.input.value.trim());
            const newMinerAddress = eHTML.modals.unifiedModal.input.value.trim();
            if (!newMinerAddress) {
                alert('Miner address cannot be empty.');
                return;
            }
            ws.send(JSON.stringify({ type: 'set_miner_address', data: newMinerAddress }));
            break;
        case ACTIONS.HARD_RESET:
            ws.send(JSON.stringify({ type: 'hard_reset', data: nodeId }));
            break;
        case ACTIONS.UPDATE_GIT:
            ws.send(JSON.stringify({ type: 'update_git', data: nodeId }));
            break;
        case ACTIONS.FORCE_RESTART:
            ws.send(JSON.stringify({ type: 'force_restart', data: nodeId }));
            break;
        case ACTIONS.REVALIDATE:
            ws.send(JSON.stringify({ type: 'force_restart_revalidate_blocks', data: nodeId }));
            break;
        case ACTIONS.RESET_WALLET:
            const resetPrivKey = eHTML.modals.unifiedModal.input.value.trim();
            if (!resetPrivKey) {
                alert('Private key is required to reset the wallet.');
                return;
            }
            ws.send(JSON.stringify({ type: 'reset_wallet', data: resetPrivKey }));
            break;
        default:
            console.error('Unknown action:', currentAction);
    }
    currentAction = null;
    closeModal();
});

// Unified modal cancel button
eHTML.modals.unifiedModal.cancelBtn.addEventListener('click', () => {
    currentAction = null;
    closeModal();
});

// Toggle password visibility in unified modal
eHTML.modals.unifiedModal.toggleInputBtn.addEventListener('click', () => {
    togglePasswordVisibility(eHTML.modals.unifiedModal.input, eHTML.modals.unifiedModal.toggleInputBtn);
});

// Validator Address Edit Button
eHTML.validatorAddressEditBtn.addEventListener('click', () => {
    console.log('validatorAddressEditBtn clicked');
    openModal(ACTIONS.SET_VALIDATOR_ADDRESS, {
        message: 'Please enter the new Validator Address:',
        inputLabel: 'Validator Address:',
        inputType: 'text',
        inputPlaceholder: 'Enter new Validator Address',
        showInput: true,
        showToggle: false
    });
});


// Miner Address Edit Button
eHTML.minerAddressEditBtn.addEventListener('click', () => {
    console.log('minerAddressEditBtn clicked');
    openModal(ACTIONS.SET_MINER_ADDRESS, {
        message: 'Please enter the new Miner Address:',
        inputLabel: 'Miner Address:',
        inputType: 'text',
        inputPlaceholder: 'Enter new Miner Address',
        showInput: true,
        showToggle: false
    });
});

// Prevent form submission
document.addEventListener('submit', function(event) { event.preventDefault(); });

// Input validation
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

// Stake Input Confirm Button
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

// Miner Threads Event Listeners
eHTML.minerThreads.input.addEventListener('change', () => {
    console.log('set_miner_threads', eHTML.minerThreads.input.value);
    ws.send(JSON.stringify({ type: 'set_miner_threads', data: eHTML.minerThreads.input.value }));
});
eHTML.minerThreads.decrementBtn.addEventListener('click', () => adjustInputValue(eHTML.minerThreads.input, -1));
eHTML.minerThreads.incrementBtn.addEventListener('click', () => adjustInputValue(eHTML.minerThreads.input, 1));

// Admin Panel Toggle Button
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

// Admin Buttons Event Listeners
eHTML.forceRestartBtn.addEventListener('click', () => {
    console.log('forceRestartBtn clicked'); // Debugging line
    currentAction = ACTIONS.FORCE_RESTART;
    openModal(ACTIONS.FORCE_RESTART, {
        message: 'Are you sure you want to restart the node? This action may interrupt ongoing processes.',
        showInput: false
    });
});


eHTML.RevalidateBtn.addEventListener('click', () => {
    currentAction = ACTIONS.REVALIDATE;
    openModal(ACTIONS.REVALIDATE, {
        message: 'Are you sure you want to revalidate the blocks? This may take some time.',
        showInput: false
    });
});

eHTML.resetInfoBtn.addEventListener('click', () => {
    currentAction = ACTIONS.RESET_WALLET;
    openModal(ACTIONS.RESET_WALLET, {
        message: 'Are you sure you want to reset the wallet? Please enter your private key below.',
        inputLabel: 'Private Key:',
        inputType: 'password',
        showInput: true,
        showToggle: true
    });
});

eHTML.eraseChainDataBtn.addEventListener('click', () => {
    currentAction = ACTIONS.ERASE_CHAIN_DATA;
    openModal(ACTIONS.ERASE_CHAIN_DATA, {
        message: 'Are you sure you want to erase the chain data? This action cannot be undone.',
        showInput: false
    });
});

eHTML.hardResetBtn.addEventListener('click', () => {
    currentAction = ACTIONS.HARD_RESET;
    openModal(ACTIONS.HARD_RESET, {
        message: 'Are you sure you want to perform a hard reset? This will reset all data and resync the chain.',
        showInput: false
    });
});

eHTML.updateGitBtn.addEventListener('click', () => {
    currentAction = ACTIONS.UPDATE_GIT;
    openModal(ACTIONS.UPDATE_GIT, {
        message: 'Do you want to update the client using Git?',
        showInput: false
    });
});

eHTML.modals.unifiedModal.cancelBtn.addEventListener('click', () => {
    console.log('Cancel button clicked');
    currentAction = null;
    closeModal();
});


// Function to open unified modal
function openModal(action, options) {
    if (modalOpen) { return; }
    modalOpen = true;
    currentAction = action;

    const modals = eHTML.modals;
    const modal = modals.unifiedModal;

    // Set the message
    modal.message.textContent = options.message || 'Are you sure?';

    // Handle dynamic input
    if (options.showInput) {
        modal.inputSection.style.display = 'block';
        modal.inputLabel.textContent = options.inputLabel || 'Input:';
        modal.input.type = options.inputType || 'text';
        modal.input.value = ''; // Clear previous value

        // Set placeholder dynamically
        if (options.inputPlaceholder) {
            modal.input.placeholder = options.inputPlaceholder;
        } else {
            // Default placeholder based on input type
            modal.input.placeholder = options.inputType === 'password' ? 'Enter your private key' : '';
        }

        if (options.inputType === 'password') {
            modal.toggleInputBtn.style.display = 'inline';
            modal.input.type = 'password';
            modal.toggleInputBtn.textContent = 'Show';
        } else {
            modal.toggleInputBtn.style.display = 'none';
        }
    } else {
        modal.inputSection.style.display = 'none';
        modal.input.value = '';
    }

    // Show the modal
    modals.wrap.classList.remove('hidden', 'fold'); // Remove both classes
    modal.wrap.classList.remove('hidden'); // Ensure modal is visible

    // Initialize animation properties
    modals.wrap.style.transform = 'scaleX(0) scaleY(0) skewX(0deg)';
    modals.wrap.style.opacity = 0;
    modals.wrap.style.clipPath = 'circle(6% at 50% 50%)';

    // Animate the modal appearance
    anime({
        targets: modals.wrap,
        scaleX: 1,
        scaleY: 1,
        opacity: 1,
        duration: 600,
        easing: 'easeOutQuad',
        complete: () => {
            if (options.showInput) {
                modal.input.focus();
                console.log('Focused on input field.');
            } else {
                modal.confirmBtn.focus();
                console.log('Focused on confirm button.');
            }
        }
    });
    anime({
        targets: modals.wrap,
        clipPath: 'circle(100% at 50% 50%)',
        delay: 200,
        duration: 800,
        easing: 'easeOutQuad',
    });
}



// Function to close unified modal
function closeModal() {
    if (!modalOpen) { return false; }
    modalOpen = false;
    const modals = eHTML.modals;
    const modal = modals.unifiedModal;
    const modalsWrap = modals.wrap;

    if (modalsWrap.classList.contains('fold')) { return false; }
    modalsWrap.classList.add('fold');

    anime({
        targets: modalsWrap,
        clipPath: 'circle(6% at 50% 50%)',
        duration: 600,
        easing: 'easeOutQuad',
    });
    anime({
        targets: modals.wrap,
        scaleX: 0,
        scaleY: 0,
        opacity: 0,
        duration: 800,
        easing: 'easeOutQuad',
        complete: () => {
            if (!modalsWrap.classList.contains('fold')) { return; }

            modals.wrap.classList.add('hidden');
            modal.input.value = '';
            modal.inputSection.style.display = 'none';
            modalsWrap.classList.remove('fold'); // Reset for next use
        }
    });
}

function togglePasswordVisibility(inputElement, toggleButton) {
    if (inputElement.type === 'password') {
        inputElement.type = 'text';
        toggleButton.textContent = 'Hide';
    } else {
        inputElement.type = 'password';
        toggleButton.textContent = 'Show';
    }
}
function adjustInputValue(targetInput, delta, min = 1, max = 16) {
    const currentValue = parseInt(targetInput.value);
    if (isNaN(currentValue)) {
        targetInput.value = min;
    } else {
        if (delta < 0) {
            targetInput.value = Math.max(currentValue + delta, min);
        } else {
            targetInput.value = Math.min(currentValue + delta, max);
        }
    }
    targetInput.dispatchEvent(new Event('change'));
}
