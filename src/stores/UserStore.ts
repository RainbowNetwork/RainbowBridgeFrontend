import { action, observable } from 'mobx';
import { IStores } from 'stores';
import { statusFetching } from '../constants';
import { StoreConstructor } from './core/StoreConstructor';
import * as agent from 'superagent';
import { IOperation } from './interfaces';
import { divDecimals, fixUnlockToken, formatWithSixDecimals, sleep, unlockToken } from '../utils';
import { BroadcastMode, CosmWasmClient, SigningCosmWasmClient } from 'secretjs';
import { getViewingKey, QueryDeposit, QueryRewards, Snip20GetBalance } from '../blockchain-bridge';
import { AsyncSender } from '../blockchain-bridge/scrt/asyncSender';

export const rewardsDepositKey = key => `${key}RewardsDeposit`;

export const rewardsKey = key => `${key}Rewards`;

export class UserStoreEx extends StoreConstructor {
  public declare stores: IStores;
  @observable public isAuthorized: boolean;
  public status: statusFetching;
  redirectUrl: string;

  @observable public keplrWallet: any;
  @observable public keplrOfflineSigner: any;
  @observable public secretjs: CosmWasmClient;
  @observable public secretjsSend: AsyncSender;
  @observable public isKeplrWallet = false;
  @observable public error: string;

  @observable public sessionType: 'mathwallet' | 'ledger' | 'wallet';
  @observable public address: string;
  @observable public balanceSCRT: string;

  @observable public balanceToken: { [key: string]: string } = {};
  @observable public balanceTokenMin: { [key: string]: string } = {};

  @observable public balanceRewards: { [key: string]: string } = {};

  @observable public scrtRate = 0;
  @observable public ethRate = 0;

  @observable public snip20Address = '';
  @observable public snip20Balance = '';
  @observable public snip20BalanceMin = '';

  @observable public isInfoReading = false;
  @observable public isInfoEarnReading = false;
  @observable public chainId: string;

  @observable public ws: WebSocket;

  constructor(stores) {
    super(stores);

    // setInterval(() => this.getBalances(), 15000);

    this.getRates();

    // Load tokens from DB
    this.stores.tokens.init();
    this.stores.tokens.fetch();

    const keplrCheckPromise = new Promise<void>((accept, _reject) => {
      // 1. Every one second, check if Keplr was injected to the page
      const keplrCheckInterval = setInterval(async () => {
        this.isKeplrWallet =
          // @ts-ignore
          !!window.keplr &&
          // @ts-ignore
          !!window.getOfflineSigner &&
          // @ts-ignore
          !!window.getEnigmaUtils;
        // @ts-ignore
        this.keplrWallet = window.keplr;

        if (this.isKeplrWallet) {
          // Keplr is present, stop checking
          clearInterval(keplrCheckInterval);
          accept();
        }
      }, 1000);
    });

    const session = localStorage.getItem('keplr_session');

    const sessionObj = JSON.parse(session);

    if (sessionObj) {
      this.address = sessionObj.address;
      this.isInfoReading = sessionObj.isInfoReading;
      this.isInfoEarnReading = sessionObj.isInfoEarnReading;
      keplrCheckPromise.then(async () => {
        await this.signIn();

        this.getBalances();

        //this.websocketInit();
      });
    }
  }

  @action public setSnip20Balance(balance: string) {
    this.snip20Balance = balance;
  }

  @action public setSnip20BalanceMin(balance: string) {
    this.snip20BalanceMin = balance;
  }

  @action public async websocketTerminate(waitToBeOpen?: boolean) {
    if (waitToBeOpen) {
      while (!this.ws && this.ws.readyState !== WebSocket.OPEN) {
        await sleep(100);
      }
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close(1000 /* Normal Closure */, 'Ba bye');
    }
  }

  @action public setInfoReading() {
    this.isInfoReading = true;
    this.syncLocalStorage();
  }

  @action public setInfoEarnReading() {
    this.isInfoEarnReading = true;
    this.syncLocalStorage();
  }

  @action public async signIn(wait?: boolean) {
    this.error = '';

    console.log('Waiting for Keplr...');
    while (wait && !this.keplrWallet) {
      await sleep(100);
    }
    console.log('Found Keplr');

    this.chainId = process.env.CHAIN_ID;

    // Setup Secret Testnet (not needed on mainnet)
    if (process.env.ENV !== 'MAINNET') {
      await this.keplrWallet.experimentalSuggestChain({
        chainId: this.chainId,
        chainName: process.env.CHAIN_NAME,
        rpc: process.env.SECRET_RPC,
        rest: process.env.SECRET_LCD,
        bip44: {
          coinType: 529,
        },
        coinType: 529,
        stakeCurrency: {
          coinDenom: 'SCRT',
          coinMinimalDenom: 'uscrt',
          coinDecimals: 6,
        },
        bech32Config: {
          bech32PrefixAccAddr: 'secret',
          bech32PrefixAccPub: 'secretpub',
          bech32PrefixValAddr: 'secretvaloper',
          bech32PrefixValPub: 'secretvaloperpub',
          bech32PrefixConsAddr: 'secretvalcons',
          bech32PrefixConsPub: 'secretvalconspub',
        },
        currencies: [
          {
            coinDenom: 'SCRT',
            coinMinimalDenom: 'uscrt',
            coinDecimals: 6,
          },
        ],
        feeCurrencies: [
          {
            coinDenom: 'SCRT',
            coinMinimalDenom: 'uscrt',
            coinDecimals: 6,
          },
        ],
        gasPriceStep: {
          low: 0.1,
          average: 0.25,
          high: 0.4,
        },
        features: ['secretwasm'],
      });
    }

    // Ask the user for permission
    await this.keplrWallet.enable(this.chainId);

    // @ts-ignore
    this.keplrOfflineSigner = window.getOfflineSigner(this.chainId);
    const accounts = await this.keplrOfflineSigner.getAccounts();
    this.address = accounts[0].address;
    this.isAuthorized = true;
    // @ts-ignore
    this.secretjsSend = this.initSecretJS(process.env.SECRET_POST_ADDRESS, true);
    this.secretjs = this.initSecretJS(process.env.SECRET_LCD, false);
  }

  initSecretJS = (address: string, isSigner: boolean) => {
    try {
      const client = isSigner
        ? new AsyncSender(
            address,
            this.address,
            this.keplrOfflineSigner,
            // @ts-ignore
            window.getEnigmaUtils(this.chainId),
            {
              init: {
                amount: [{ amount: '300000', denom: 'uscrt' }],
                gas: '300000',
              },
              exec: {
                amount: [{ amount: '500000', denom: 'uscrt' }],
                gas: '500000',
              },
            },
            BroadcastMode.Async,
          )
        : new CosmWasmClient(
            address,
            // @ts-ignore
          );
      this.syncLocalStorage();
      return client;
    } catch (error) {
      this.error = error.message;
      this.isAuthorized = false;
      console.error('keplr login error', error);
      return undefined;
    }
  };

  @action public getSnip20Balance = async (snip20Address: string, decimals?: string | number): Promise<string> => {
    if (!this.secretjs) {
      return '0';
    }

    const viewingKey = await getViewingKey({
      keplr: this.keplrWallet,
      chainId: this.chainId,
      address: snip20Address,
    });

    if (!viewingKey) {
      return unlockToken;
    }

    const rawBalance = await Snip20GetBalance({
      secretjs: this.secretjs,
      token: snip20Address,
      address: this.address,
      key: viewingKey,
    });

    if (isNaN(Number(rawBalance))) {
      return fixUnlockToken;
    }

    if (decimals) {
      const decimalsNum = Number(decimals);
      return divDecimals(rawBalance, decimalsNum);
    }

    return rawBalance;
  };

  @action public getBridgeRewardsBalance = async (snip20Address: string, noheight): Promise<string> => {
    if (!this.secretjs) {
      return '0';
    }

    let height = noheight ? undefined : String(await this.secretjs.getHeight());

    const viewingKey = await getViewingKey({
      keplr: this.keplrWallet,
      chainId: this.chainId,
      address: snip20Address,
    });
    if (!viewingKey) {
      throw new Error('Failed to get viewing key');
    }

    try {
      return await QueryRewards({
        cosmJS: this.secretjs,
        contract: snip20Address,
        address: this.address,
        key: viewingKey,
        height: height,
      });
    } catch (e) {
      try {
        height = String(await this.secretjs.getHeight());
        return await QueryRewards({
          cosmJS: this.secretjs,
          contract: snip20Address,
          address: this.address,
          key: viewingKey,
          height: height,
        });
      } catch (e) {
        console.error(`failed to query rewards: ${e}`);
        throw new Error('failed to query rewards');
      }
    }
  };

  @action public getBridgeDepositBalance = async (snip20Address: string): Promise<string> => {
    if (!this.secretjs) {
      return '0';
    }

    const viewingKey = await getViewingKey({
      keplr: this.keplrWallet,
      chainId: this.chainId,
      address: snip20Address,
    });
    if (!viewingKey) {
      throw new Error('Failed to get viewing key');
    }

    try {
      return await QueryDeposit({
        cosmJS: this.secretjs,
        contract: snip20Address,
        address: this.address,
        key: viewingKey,
      });
    } catch (e) {
      return await Snip20GetBalance({
        secretjs: this.secretjs,
        address: this.address,
        token: snip20Address,
        key: viewingKey,
      });
    }
  };

  @action public getBalances = async () => {
    await Promise.all([this.updateBalanceForSymbol('SCRT'), this.updateBalanceForSymbol('sSCRT')]);
  };

  @action public updateScrtBalance = async () => {
    this.secretjs.getAccount(this.address).then(account => {
      try {
        this.balanceSCRT = formatWithSixDecimals(divDecimals(account.balance[0].amount, 6));
      } catch (e) {
        this.balanceSCRT = '0';
      }
    });
    return;
  };

  @action public updateSScrtBalance = async () => {
    try {
      const balance = await this.getSnip20Balance(process.env.SSCRT_CONTRACT, 6);
      this.balanceToken['sSCRT'] = balance;
    } catch (err) {
      this.balanceToken['sSCRT'] = unlockToken;
    }

    const token = this.stores.tokens.allData.find(t => t.display_props.symbol === 'SSCRT');

    if (!token) {
      return;
    }

    try {
      this.balanceTokenMin['sSCRT'] = token.display_props.min_from_scrt;
    } catch (e) {
      console.log(`unknown error: ${e}`);
    }
    return;
  };

  @action public updateBalanceForRewardsToken = async (tokenAddress: string) => {
    while (!this.address && !this.secretjs && this.stores.tokens.isPending) {
      await sleep(100);
    }
  };

  @action public updateBalanceForSymbol = async (symbol: string) => {
    while (!this.address && !this.secretjs && this.stores.tokens.allData.length === 0) {
      await sleep(100);
    }

    if (!symbol) {
      return;
    } else if (symbol === 'SCRT') {
      await this.updateScrtBalance();
    } else if (symbol === 'sSCRT') {
      await this.updateSScrtBalance();
    }

    //console.log(symbol)

    await this.refreshTokenBalance(symbol);

    //await this.refreshRewardsBalances(symbol);
  };

  private async refreshTokenBalance(symbol: string) {
    const token = this.stores.tokens.allData.find(t => t.display_props.symbol === symbol);

    if (!token) {
      return;
    }

    try {
      const balance = await this.getSnip20Balance(token.dst_address, token.decimals);
      this.balanceToken[token.src_coin] = balance;
    } catch (err) {
      this.balanceToken[token.src_coin] = unlockToken;
    }

    try {
      this.balanceTokenMin[token.src_coin] = token.display_props.min_from_scrt;
    } catch (e) {
      console.log(`unknown error: ${e}`);
    }
  }

  async refreshRewardsBalances(symbol: string) {
    let rewardsToken = this.stores.rewards.allData.find(t => {
      return t.inc_token.symbol.toLowerCase() === symbol.toLowerCase();
    });
    if (!rewardsToken) {
      // old style rewards token (earn page)
      rewardsToken = this.stores.rewards.allData.find(t => {
        return t.inc_token.symbol.toLowerCase().includes(symbol.toLowerCase());
      });

      if (!rewardsToken) {
        console.log('No rewards token for', symbol);
        throw new Error(`No rewards token for ${symbol}`);
      }
    }

    try {
      const balance = await this.getBridgeRewardsBalance(rewardsToken.pool_address, false);

      if (balance.includes(unlockToken)) {
        this.balanceRewards[rewardsKey(rewardsToken.inc_token.symbol)] = balance;
      } else {
        // rewards are in the rewards_token decimals
        this.balanceRewards[rewardsKey(rewardsToken.inc_token.symbol)] = divDecimals(
          balance,
          rewardsToken.rewards_token.decimals,
        ); //divDecimals(balance, token.inc_token.decimals);
      }
    } catch (err) {
      this.balanceRewards[rewardsKey(rewardsToken.inc_token.symbol)] = unlockToken;
    }

    try {
      const balance = await this.getBridgeDepositBalance(rewardsToken.pool_address);

      if (balance.includes(unlockToken)) {
        this.balanceRewards[rewardsDepositKey(rewardsToken.inc_token.symbol)] = balance;
      } else {
        this.balanceRewards[rewardsDepositKey(rewardsToken.inc_token.symbol)] = divDecimals(
          balance,
          rewardsToken.inc_token.decimals,
        );
      }
    } catch (err) {
      this.balanceRewards[rewardsDepositKey(rewardsToken.inc_token.symbol)] = unlockToken;
    }

    try {
      const balance = await this.getSnip20Balance(
        rewardsToken.rewards_token.address,
        rewardsToken.rewards_token.decimals,
      );

      if (balance.includes(unlockToken)) {
        this.balanceRewards[rewardsToken.rewards_token.symbol] = balance;
      } else {
        this.balanceRewards[rewardsToken.rewards_token.symbol] = divDecimals(
          balance,
          rewardsToken.rewards_token.decimals,
        );
      }
    } catch (err) {
      this.balanceRewards[rewardsToken.rewards_token.symbol] = unlockToken;
    }
  }

  @action public signOut() {
    this.isAuthorized = false;
    this.address = null;
    this.syncLocalStorage();
  }

  private syncLocalStorage() {
    localStorage.setItem(
      'keplr_session',
      JSON.stringify({
        address: this.address,
        isInfoReading: this.isInfoReading,
        isInfoEarnReading: this.isInfoEarnReading,
      }),
    );
  }

  @action public signTransaction(txn: any) {
    /*  if (this.sessionType === 'mathwallet' && this.isKeplrWallet) {
      return this.keplrWallet.signTransaction(txn);
    } */
  }

  public saveRedirectUrl(url: string) {
    if (!this.isAuthorized && url) {
      this.redirectUrl = url;
    }
  }

  @action public async getRates() {
    const scrtbtc = await agent.get<{ body: IOperation }>('https://api.binance.com/api/v1/ticker/24hr?symbol=SCRTBTC');
    const btcusdt = await agent.get<{ body: IOperation }>('https://api.binance.com/api/v1/ticker/24hr?symbol=BTCUSDT');

    this.scrtRate = scrtbtc.body.lastPrice * btcusdt.body.lastPrice;

    const ethusdt = await agent.get<{ body: IOperation }>('https://api.binance.com/api/v1/ticker/24hr?symbol=ETHUSDT');

    this.ethRate = ethusdt.body.lastPrice;
  }
}
