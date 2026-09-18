export type CapabilityStatus = 'supported' | 'unsupported' | 'unverified';
export type ProviderExecutionCapabilities = {
    artifactDelivery: CapabilityStatus; interactiveExecution: CapabilityStatus; unattendedController: CapabilityStatus;
    nativeSubagents: CapabilityStatus; modelOverride: CapabilityStatus; effortOverride: CapabilityStatus;
    observedModelEvidence: CapabilityStatus; durableResume: CapabilityStatus;
};
