import * as React from 'react';
import { Box } from 'grommet';
import { BaseContainer, PageContainer } from 'components';
import { observer } from 'mobx-react-lite';
import { useStores } from 'stores';
import * as styles from './styles.styl';
import { Exchange } from '../Exchange';
import { TOKEN } from 'stores/interfaces';
import { Title } from 'components/Base';
import { WalletBalances } from './WalletBalances';
import { useEffect, useState } from 'react';
import { EXCHANGE_STEPS } from 'stores/Exchange';
import { BridgeHealth } from '../../components/Secret/BridgeHealthIndicator';
import { messages, messageToString } from './messages';
import { Message } from 'semantic-ui-react';
import { ClaimTokenErc, ClaimTokenScrt } from '../../components/Earn/ClaimToken';

export const enum NETWORKS {
  ETH,
  BSC,
  PLSM,
}

export const EthBridge = observer((props: any) => {
  const { exchange, rewards, signerHealth, tokens } = useStores();
  //userMetamask
  //const [network, setNetwork] = useState<NETWORKS>(NETWORKS.ETH);

  useEffect(() => {
    rewards.init({
      isLocal: true,
      sorter: 'none',
      pollingInterval: 20000,
    });
    rewards.fetch();

    tokens.init(); //TODO

    signerHealth.init({});
    signerHealth.fetch();

    // if (props.match.params.token) {
    //   if ([TOKEN.NATIVE, TOKEN.ERC20].includes(props.match.params.token)) {
    //     exchange.setToken(props.match.params.token);
    //   }
    // }

    if (props.match.params.operationId) {
      exchange.setOperationId(props.match.params.operationId);
    }
  }, []);

  useEffect(() => {
    if (exchange.step === EXCHANGE_STEPS.CHECK_TRANSACTION && exchange.operation) exchange.fetchStatus(exchange.operation.id)
  }, [exchange.step]);

  // useEffect(() => {
  //   if (userMetamask.network) {
  //     exchange.setNetwork(userMetamask.network);
  //     exchange.setMainnet(userMetamask.mainnet);
  //     setNetwork(userMetamask.network);
  //   }
  // }, [userMetamask.network, userMetamask.mainnet, exchange]);

  return (
    <BaseContainer>
      <PageContainer>
        <Box direction="row" wrap={true} fill justify="between" align="start">
          <Box fill direction="column" align="center" justify="center" className={styles.base}>
            <Message info>
              <Message.Header>The
              <a href="https://scrt.network/blog/sefi-is-live-on-mainnet" style={{ textDecoration: 'none' }} target="_blank" rel="noreferrer"> SEFI governance token </a>
                is now LIVE!</Message.Header>
              <p>{'Click '}
                <a href="/sefi" style={{ textDecoration: 'underline' }} rel="noreferrer">HERE</a>
                {' '} to claim your genesis tokens (if eligible) and to stake your SEFI and LP tokens.
            </p>
            </Message>
            <Box fill direction="row" justify="between" align="end" margin={{ bottom: 'medium', top: 'large' }}>
              <Title bold>Secret Bridge</Title>
              <WalletBalances />
            </Box>
            <Exchange />
          </Box>
        </Box>
      </PageContainer>
    </BaseContainer>
  );
});
