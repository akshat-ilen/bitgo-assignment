const _ = require('lodash');
const axios = require('axios');
const process = require('process');
const axios_cache = require('axios-cache-adapter').setupCache;
const unwind = require('lodash-unwind')();

const API_URL = 'https://blockstream.info/api/';
const BLOCK_HEIGHT = 680000;
const BLOCK_TRANSACTION_PAGE_LIMIT = 25;
const TOP_RESULT_LIMIT = 10;

// Cache Setup
const cache = axios_cache({
    maxAge: 180 * 60 * 1000, // 3 Hour
});

const api = axios.create({
    adapter: cache.adapter,
});


//Get the block hash by block height.
const getBlockHashByHeight = async (blockHeight) => {
    console.log('getBlockHashByHeight: Started');
    try {
        const blockHash = await api({ url: `${API_URL}block-height/${blockHeight}`, method: 'get'});
        return blockHash.data;
    } catch(err) {
        console.error('Error: getBlockHashByHeight: ' ,err.message);
        process.exit(0);
    }
};

// Get the block details by block hash.
const getBlockInfoByHash = async (hashId) => {
    console.log('getBlockInfoByHash: Started')
    try {
        const blockHash = await api({ url: `${API_URL}block/${hashId}`, method: 'get'})
        return blockHash.data
    } catch(err) {
        console.error('Error: getBlockInfoByHash: ' ,err.message)
        process.exit(0)
    }
}

// Get all the transactions by Pagination based on :start-index.
const getAllTransactionsInBlock = async (hashId,noOfTransactions) => {
    console.log('getAllTransactionsInBlock: Started')
    const transactions = [];
    let startIndex = 0;
    const endIndex = noOfTransactions;

    while(startIndex <= endIndex) {
        console.log(`Fetching transactions ${startIndex+1} - ${startIndex + BLOCK_TRANSACTION_PAGE_LIMIT} out of ${endIndex}`);
        try {
            const transactionsPerPage = await api({ 
                url: `${API_URL}block/${hashId}/txs/${startIndex}`, 
                method: 'get',
            })
            transactions.push(...transactionsPerPage.data);
        } catch(err) {
            console.log(`Error: Fetching transactions ${startIndex+1} - ${startIndex + BLOCK_TRANSACTION_PAGE_LIMIT}: ${err.message}`);
            startIndex += BLOCK_TRANSACTION_PAGE_LIMIT;
            continue;
        }
        startIndex += BLOCK_TRANSACTION_PAGE_LIMIT;
    }
    return transactions;
}

// Getting all the ancestors for all the trnasction in a block.
const getAncestorsForTransactions = (transactions) => {
    console.log('getAncestorsForTransactions: Started');
    
    // Picking necessary attributes & unwinding it.
    const optimisedTransaction = unwind(transactions.map(transaction => {
        return {
            txid: transaction.txid,
            input: transaction.vin.map(x => x. txid),
        }
    }), 'input')

    const transactionGraph = createGraphFromTransactions(optimisedTransaction);

    const allAncestors = []
    
    for (const transaction of transactions) {
        const ancestors = findAncestorsForTransaction(transactionGraph ,transaction.txid);
        
        // Filtering out self transaction id
        const ancestorArray = ancestors 
            ? Array.from(ancestors).filter(x => x !== transaction.txid) 
            : [];
        
        allAncestors.push({
            txid: transaction.txid,
            ancestors: ancestorArray,
            ancestorsCount: ancestorArray.length
        })
    }

    return allAncestors;
}

// Creating a graph for all the transactions to process the ancestors.
const createGraphFromTransactions = (transactions) => {
    console.log('getAncestorsForTransactions: Started');

    const graph = new Map();

    const addNodes = (transaction) => {
        graph.set(transaction.txid, []);
    }
    
    const addEdge = (child, parent) => {
        graph.get(child).push(parent);
    }
    
    //Create a graph
    transactions.forEach(addNodes)
    transactions.forEach(transaction => addEdge(transaction.txid, transaction.input));

    return graph;
}

// Finding the ancestors for all the transactions in a block;
const findAncestorsForTransaction = (graph, start, visited = new Set()) => {
    visited.add(start);
    const destinations = graph.get(start);

    for (const destination of destinations) {
        if (!graph.has(destination)) return;
        
        if (!visited.has(destination)) findAncestorsForTransaction(graph, destination, visited);
    }

    return visited;
}

/* 
    Prints the 10 transaction with the largest ancestry sets.
    Output format: txid and ancestry set size.
*/
const printRequiredResult = (transactions) => {
    console.log(`----------- Top ${TOP_RESULT_LIMIT} Transactions with highest no. of Ancestors -----------`);
    
    const result = _.orderBy(transactions, 'ancestorsCount', 'desc')
        .map(x => ({ txid: x.txid, ancestorsCount: x.ancestorsCount }))
        .slice(0, TOP_RESULT_LIMIT);

    console.table(result);
}

const main = async () => {
    const blockhash = await getBlockHashByHeight(BLOCK_HEIGHT);
    console.log('BLOCKHASH: ', blockhash);

    const blockInfo = await getBlockInfoByHash(blockhash);
    
    const transactions = await getAllTransactionsInBlock(blockhash, blockInfo.tx_count);

    if (!transactions.length) {
        console.log(`There are no transaction in the block for the Block-height: ${BLOCK_HEIGHT}`)
        process.exit(0);
    }

    const ancestorsWithTransactions = getAncestorsForTransactions(transactions);

    printRequiredResult(ancestorsWithTransactions);    

}

main();
