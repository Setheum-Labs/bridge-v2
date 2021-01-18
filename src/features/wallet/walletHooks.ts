import { useMultiwallet } from '@renproject/multiwallet-ui'
import { useCallback, useEffect, useMemo } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useDebounce } from 'react-use'
import Web3 from 'web3'
import { WalletConnectionStatusType, WalletStatus, } from '../../components/utils/types'
import { storageKeys } from '../../constants/constants'
import { signWithBinanceChain } from '../../services/wallets/bsc'
import { BridgeWallet, RenChain } from '../../utils/assetConfigs'
import { $renNetwork } from '../network/networkSlice'
import { $multiwalletChain, $walletUser, setAuthAlertOpened, setSignatures, } from './walletSlice'

type WalletData = ReturnType<typeof useMultiwallet> & {
  account: string;
  status: WalletConnectionStatusType;
  walletConnected: boolean;
  provider: any;
  symbol: BridgeWallet;
  deactivateConnector: () => void;
};

const resolveWallet = (provider: any) => {
  if (provider?.isMetaMask) {
    return BridgeWallet.METAMASKW;
  } else if (
    provider?.chainId === "0x61" ||
    provider?.chainId.indexOf("Binance")
  ) {
    return BridgeWallet.BINANCESMARTW;
  }
  return BridgeWallet.UNKNOWNW;
};

type UseWallet = (chain: string) => WalletData;

export const useWallet: UseWallet = (chain) => {
  const {
    enabledChains,
    targetNetwork,
    activateConnector,
    setTargetNetwork,
  } = useMultiwallet();
  const { account = "", status = "disconnected" } =
    enabledChains?.[chain] || {};
  const provider = enabledChains?.[chain]?.provider;
  const symbol = resolveWallet(provider);
  const emptyFn = () => {};
  const deactivateConnector =
    enabledChains[chain]?.connector.deactivate || emptyFn;

  return {
    account,
    status,
    walletConnected: status === WalletStatus.CONNECTED,
    provider,
    symbol,
    targetNetwork,
    enabledChains,
    activateConnector,
    setTargetNetwork,
    deactivateConnector,
  } as WalletData;
};

export const useSelectedChainWallet = () => {
  const multiwalletChain = useSelector($multiwalletChain);
  return useWallet(multiwalletChain);
};

export const useSyncMultiwalletNetwork = () => {
  const { targetNetwork, setTargetNetwork } = useSelectedChainWallet();
  const renNetwork = useSelector($renNetwork);
  useEffect(() => {
    if (renNetwork !== targetNetwork) {
      console.log("syncing multiwallet with network", renNetwork);
      setTargetNetwork(renNetwork);
    }
  }, [renNetwork, setTargetNetwork, targetNetwork]);
};

const SIGN_MESSAGE = "Allow RenBridge to back up transactions";

const getWeb3Signatures = async (
  address: string,
  web3: Web3,
  chain: RenChain
) => {
  const localSigMap = JSON.parse(
    localStorage.getItem(storageKeys.SIG_MAP) || "{}"
  );
  const localRawSigMap = JSON.parse(
    localStorage.getItem(storageKeys.RAW_SIG_MAP) || "{}"
  );
  const addressLowerCase = address.toLowerCase();

  let signature: string = localSigMap[addressLowerCase] || "";
  let rawSignature: string = localRawSigMap[addressLowerCase] || "";

  if (!signature || !rawSignature) {
    // get unique wallet signature for database backup
    if (
      chain === RenChain.ethereum ||
      // signing is actually based on wallet, not chain,
      // so use this style if the provider is eth
      // TODO: move signing functionality into multiwallet?
      (web3.currentProvider as any).connection.isMetaMask
    ) {
      rawSignature = await web3.eth.personal.sign(
        web3.utils.utf8ToHex(SIGN_MESSAGE),
        addressLowerCase,
        ""
      );
    } else if (chain === RenChain.binanceSmartChain) {
      rawSignature = await signWithBinanceChain(SIGN_MESSAGE);
    }

    localRawSigMap[addressLowerCase] = rawSignature;
    localStorage.setItem(
      storageKeys.RAW_SIG_MAP,
      JSON.stringify(localRawSigMap)
    );

    signature = web3.utils.sha3(rawSignature);
    localSigMap[addressLowerCase] = signature;
    localStorage.setItem(storageKeys.SIG_MAP, JSON.stringify(localSigMap));
  }
  return { signature, rawSignature };
};

// TODO TBD: cache for more wallet providers?
const useWeb3 = () => {
  const { provider } = useSelectedChainWallet();
  return useMemo(() => new Web3(provider), [provider]);
};

export const useSignatures = () => {
  const dispatch = useDispatch();
  const chain = useSelector($multiwalletChain);
  const { account } = useWallet(chain);
  const web3 = useWeb3();
  const getSignatures = useCallback(() => {
    if (account && web3) {
      getWeb3Signatures(account, web3, chain)
        .then((signatures) => {
          dispatch(setSignatures(signatures));
        })
        .catch(console.error);
    }
  }, [dispatch, chain, account, web3]);

  return { getSignatures };
};

export const useWeb3Signatures = () => {
  const { getSignatures } = useSignatures();
  useEffect(() => {
    getSignatures();
  }, [getSignatures]);

  return { getSignatures };
};

export const useAuthentication = () => {
  const { account } = useSelectedChainWallet();
  const user = useSelector($walletUser);
  const { getSignatures } = useSignatures();
  const isAuthenticated = user !== null && account === user.uid;

  return { isAuthenticated, authenticate: getSignatures };
};

export const useAuthGuard = () => {
  const dispatch = useDispatch();
  const { isAuthenticated } = useAuthentication();
  useDebounce(
    () => {
      dispatch(setAuthAlertOpened(!isAuthenticated));
    },
    2000,
    [isAuthenticated]
  );
};