// public/main.js

document.addEventListener('DOMContentLoaded', function () {
    console.log('DOMContentLoaded event fired');
    fetchStats();
    fetchUTXOs();
});

function fetchStats() {
    console.log('Fetching stats...');
    fetch('/api/stats')
        .then(response => response.json())
        .then(data => {
            document.getElementById('total-supply').textContent = data.totalSupply;
            document.getElementById('total-balances').textContent = data.totalOfBalances;
        })
        .catch(error => {
            console.error('Error fetching stats:', error);
            document.getElementById('total-supply').textContent = 'Error';
            document.getElementById('total-balances').textContent = 'Error';
        });
}

function fetchUTXOs() {
    console.log('Fetching UTXOs...');
    const loader = document.getElementById('utxo-loader');
    const tbody = document.getElementById('utxo-tbody');
    loader.style.display = 'block';

    fetch('/api/utxos')
        .then(response => response.json())
        .then(data => {
            loader.style.display = 'none';
            data.forEach(utxo => {
                const tr = document.createElement('tr');

                const tdKey = document.createElement('td');
                const anchorLink = document.createElement('a');
                anchorLink.href = '#';
                anchorLink.textContent = utxo.key;
                anchorLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    fetchUTXODetails(utxo.key);
                });
                tdKey.appendChild(anchorLink);

                const tdValue = document.createElement('td');
                tdValue.textContent = utxo.value;

                tr.appendChild(tdKey);
                tr.appendChild(tdValue);
                tbody.appendChild(tr);
            });
        })
        .catch(error => {
            loader.style.display = 'none';
            console.error('Error fetching UTXOs:', error);
        });
}

function fetchUTXODetails(anchor) {
    console.log(`Fetching UTXO details for anchor: ${anchor}`);
    fetch(`/api/utxo/${encodeURIComponent(anchor)}`)
        .then(response => response.json())
        .then(data => {
            alert(`UTXO Details:\nAnchor: ${data.key}\nValue: ${data.value}`);
        })
        .catch(error => {
            console.error('Error fetching UTXO details:', error);
            alert('Error fetching UTXO details');
        });
}
