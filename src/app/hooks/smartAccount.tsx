import { JiffyPaymaster } from "@jiffy-labs/web3a";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useSetActiveWallet } from "@privy-io/wagmi";
import { ENTRYPOINT_ADDRESS_V06, SmartAccountClient, createSmartAccountClient, walletClientToSmartAccountSigner } from "permissionless";
import { signerToSimpleSmartAccount } from "permissionless/accounts";
import { createPimlicoBundlerClient } from "permissionless/clients/pimlico";
import { ENTRYPOINT_ADDRESS_V06_TYPE } from "permissionless/types";
import { useEffect, useMemo, useState } from "react";
import { fuse } from "viem/chains";
import { http, useAccount, useDisconnect, usePublicClient, useWalletClient } from "wagmi";

const jiffyscanKey = process.env.NEXT_PUBLIC_JIFFYSCAN_API_KEY as string;
const bundlerUrl = process.env.NEXT_PUBLIC_BUNDLER_URL as string;
// Define the chains with their respective entry points and RPC URLs
export const CHAINS = [
    {
        name: "Fuse",
        chain: fuse,
        bundlerUrl: bundlerUrl,
        explorerUrl: "https://explorer.fuse.io/tx/",
    },
];

// write a simple counter hook no web3 stuff
export function useSmartAccount() {
    const [smartAccountClient, setSmartAccountClient] = useState<SmartAccountClient<ENTRYPOINT_ADDRESS_V06_TYPE> | null>(null);

    const { wallets } = useWallets();
    const { isConnected } = useAccount();
    const publicClient = usePublicClient();
    const { data: walletClient } = useWalletClient();
    const [selectedChain, setSelectedChain] = useState(CHAINS[0]);
    const embeddedWallet = useMemo(() => wallets.find((wallet) => wallet.walletClientType === "privy"), [wallets]);
    const { setActiveWallet } = useSetActiveWallet();

    useEffect(() => {
        if (embeddedWallet) {
            setActiveWallet(embeddedWallet);
        }
    }, [embeddedWallet]);

    useEffect(() => {
        (async () => {
            if (isConnected && walletClient && publicClient) {
                const customSigner = walletClientToSmartAccountSigner(walletClient);
                const bundlerTransport = http(selectedChain.bundlerUrl, {
                    fetchOptions: {
                        headers: { "x-api-key": jiffyscanKey },
                    },
                });
                const bundlerClient = createPimlicoBundlerClient({
                    transport: bundlerTransport,
                    entryPoint: ENTRYPOINT_ADDRESS_V06,
                });
                const jiffyPaymaster = new JiffyPaymaster('https://paymaster.jiffyscan.xyz', selectedChain.chain.id, {
                    "x-api-key": jiffyscanKey,
                });

                const simpleSmartAccountClient = await signerToSimpleSmartAccount(publicClient, {
                    entryPoint: ENTRYPOINT_ADDRESS_V06,
                    signer: customSigner,
                });

                const smartAccountClient = createSmartAccountClient({
                    account: simpleSmartAccountClient,
                    entryPoint: ENTRYPOINT_ADDRESS_V06,
                    chain: selectedChain.chain,
                    bundlerTransport: bundlerTransport,
                    middleware: {
                        gasPrice: async () => (await bundlerClient.getUserOperationGasPrice()).fast,
                        sponsorUserOperation: jiffyPaymaster.sponsorUserOperationV6,
                    },
                });

                setSmartAccountClient(smartAccountClient);
            }
        })();
    }, [isConnected, walletClient, publicClient, selectedChain]);

    const handleChainChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const selectedChainId = parseInt(e.target.value);
        const selected = CHAINS.find((chain) => chain.chain.id === selectedChainId);
        if (selected) {
            setSelectedChain(selected);
        }
    };

    const fetchUserOperationHash = async (txHash: string) => {
        const uoHash = "";
        let retries = 0;
        let resObj = null;

        while (retries < 20) {
            const res = await fetch(`https://api.jiffyscan.xyz/v0/getBundleActivity?bundle=${txHash}&network=fuse&first=10&skip=0`, {
                headers: {
                    "x-api-key": jiffyscanKey,
                },
            });
            resObj = JSON.parse(await res.text());

            if ("bundleDetails" in resObj && "userOps" in resObj.bundleDetails && resObj.bundleDetails.userOps.length > 0) {
                return resObj.bundleDetails.userOps[0].userOpHash;
            } else {
                console.log("No bundle details found, retrying...");
                retries++;
                await new Promise((r) => setTimeout(r, 3000)); // wait for 2 seconds before retrying
            }
        }
        if (retries >= 5) {
            console.log("Failed to fetch bundle details after 5 retries");
        }
        return uoHash;
    };

    return { isConnected, smartAccountClient, handleChainChange, selectedChain, fetchUserOperationHash };
}
