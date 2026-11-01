// SO₂ constants (Constants page, group 'SO₂ (KMS recommendations)'); kept apart so formulation.js can merge them without a cycle.
export const SO2_CONSTANTS = {
  so2KBarrel: [0.010, 'Free SO₂ decay, barrels', 'per day', 'Starting k for barrels; replaced by fitted values as readings build up.', 'SO₂ (KMS recommendations)'],
  so2KTank: [0.004, 'Free SO₂ decay, fixed tanks', 'per day', 'Starting k for fixed-capacity tanks.', 'SO₂ (KMS recommendations)'],
  so2KVar: [0.004, 'Free SO₂ decay, variable-capacity tanks', 'per day', 'Starting k for cans (floating lids).', 'SO₂ (KMS recommendations)'],
  so2R: [0.70, 'KMS retention', 'fraction', 'Share of the SO₂ added that shows up as free SO₂; starting value until the data say otherwise.', 'SO₂ (KMS recommendations)'],
  so2UseFit: [0, 'Use measured retention', '0 or 1', '1 = doses use the retention measured from past additions (see SO₂ calibration); 0 = the retention above.', 'SO₂ (KMS recommendations)'],
  so2Shrink: [3, 'Shrinkage weight', 'pairs', 'k = (n·k_vessel + w·k_type)/(n + w); the same weight for types and for retention.', 'SO₂ (KMS recommendations)'],
  so2TotalMax: [150, 'Total SO₂ warning', 'mg/L', 'Warn when the estimated total SO₂ (last total + additions since) is above this.', 'SO₂ (KMS recommendations)'],
  so2TargetMax: [50, 'High target warning', 'mg/L', 'Warn when the free SO₂ target is above this (high pH at 0.8 molecular).', 'SO₂ (KMS recommendations)'],
  so2AssumePH: [3.6, 'Assumed pH when none recorded', 'pH', 'Used for the KMS dose when a wine has no pH reading yet (errs a little high on KMS).', 'SO₂ (KMS recommendations)'],
  so2StaleDays: [30, 'Re-test after', 'days', 'Readings older than this are flagged “re-test recommended”.', 'SO₂ (KMS recommendations)'],
};
export const LIMITS = { so2AssumePH: [2.8, 4.2], so2KBarrel: [0, 0.1], so2KTank: [0, 0.1], so2KVar: [0, 0.1], so2R: [0.1, 1.5], so2UseFit: [0, 1], so2Shrink: [0, 50], so2TotalMax: [20, 400], so2TargetMax: [10, 150], so2StaleDays: [1, 365] };
