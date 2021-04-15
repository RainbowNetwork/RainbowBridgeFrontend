import { ExecuteResult, SigningCosmWasmClient } from 'secretjs';
//import { Coin, isMsgExecuteContract, StdFee, StdTx } from 'secretjs/types/types';
import retry from 'async-await-retry';
import { sleep } from '../utils';
import { Coin, StdFee } from 'secretjs/types/types';
import { WebSocketHandler } from '../../services/websocket';

class CustomError extends Error {
  public txHash: string;
}

export class AsyncSender extends SigningCosmWasmClient {
  asyncExecute = async (
    contractAddress: string,
    handleMsg: object,
    memo?: string,
    transferAmount?: readonly Coin[],
    fee?: StdFee,
    notifier?: Function,
  ): Promise<ExecuteResult> => {
    let tx;
    try {
      if (notifier) {
        notifier('info', `Prompting user for signature..`, 2);
      }
      tx = await this.execute(contractAddress, handleMsg, memo, transferAmount, fee);
      if (notifier) {
        notifier('info', `Transaction broadcast successfully. Waiting for reply..`, 2);
      }
    } catch (e) {
      if (e.message === 'Request rejected') {
        throw new CustomError('Transaction canceled');
      }
      if (e.message.includes('502')) {
        throw new CustomError(
          'Server returned an error, but transaction might have been executed anyway. Refresh and hope for the best',
        );
      } else {
        console.error(`failed to broadcast tx: ${e}`);
        throw new CustomError('Failed to broadcast transaction: Network error');
      }
    }

    const ws = new WebSocketHandler();

    const result = await ws.getTxForAddress(this.senderAddress);
    console.log(`result: ${JSON.stringify(result)}`);

    return {
      transactionHash: undefined,
      data: result.result.data,
      logs: result.result.log,
    };
    // try {
    //   // optimistic
    //   await sleep(3000);
    //   const res = await retry(
    //     () => {
    //       return this.restClient.txById(tx.transactionHash);
    //     },
    //     null,
    //     { retriesMax: 5, interval: 6000 },
    //   );
    //
    //   //console.log(`yay! ${JSON.stringify(res)}`);
    //   return {
    //     ...res,
    //     transactionHash: tx.transactionHash,
    //   };
    // } catch (e) {
    //   console.error(`failed to broadcast tx: ${e}`);
    //   let error = new CustomError(`Timed out while waiting for transaction`);
    //   error.txHash = tx.transactionHash;
    //   throw error;
    // }
  };
}
