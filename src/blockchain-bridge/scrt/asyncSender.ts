import { SigningCosmWasmClient } from 'secretjs';
//import { Coin, isMsgExecuteContract, StdFee, StdTx } from 'secretjs/types/types';
import retry from 'async-await-retry';
import { sleep } from '../utils';
import { Coin, StdFee } from 'secretjs/types/types';

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
  ) => {
    let tx;
    try {
      if (notifier) {
        notifier('info', `Broadcasting transaction...`);
      }
      tx = await this.execute(contractAddress, handleMsg, memo, transferAmount, fee);
    } catch (e) {
      if (e.message === 'Request rejected') {
        throw new CustomError('Transaction canceled');
      }
      if (e.message.includes('502')) {
        throw new CustomError('Server returned an error, but transaction might have been executed');
      } else {
        console.error(`failed to broadcast tx: ${e}`);
        throw new CustomError('Failed to broadcast transaction: Network error');
      }
    }

    try {
      // optimistic
      await sleep(3000);
      const res = await retry(
        () => {
          return this.restClient.txById(tx.transactionHash);
        },
        null,
        { retriesMax: 5, interval: 6000 },
      );

      //console.log(`yay! ${JSON.stringify(res)}`);
      return {
        ...res,
        transactionHash: tx.transactionHash,
      };
    } catch (e) {
      console.error(`failed to broadcast tx: ${e}`);
      let error = new CustomError(`Timed out while waiting for transaction`);
      error.txHash = tx.transactionHash;
      throw error;
    }
  };
}
