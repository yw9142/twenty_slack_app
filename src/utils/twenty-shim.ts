type ValidationResult<TConfig> = {
  success: true;
  config: TConfig;
  errors: string[];
};

const createValidationResult = <TConfig>(
  config: TConfig,
): ValidationResult<TConfig> => ({
  success: true,
  config,
  errors: [],
});

// esbuild auto-detects ancestor Yarn PnP manifests during manifest extraction.
// These local shims keep entity files serializable without pulling runtime SDK code.
export const defineApplication = <TConfig>(config: TConfig) =>
  createValidationResult(config);

export const defineRole = <TConfig>(config: TConfig) =>
  createValidationResult(config);

export const defineObject = <TConfig>(config: TConfig) =>
  createValidationResult(config);

export const defineView = <TConfig>(config: TConfig) =>
  createValidationResult(config);

export const defineNavigationMenuItem = <TConfig>(config: TConfig) =>
  createValidationResult(config);

export const defineLogicFunction = <TConfig>(config: TConfig) =>
  createValidationResult(config);

export const FieldType = {
  DATE_TIME: 'DATE_TIME',
  NUMBER: 'NUMBER',
  RAW_JSON: 'RAW_JSON',
  SELECT: 'SELECT',
  TEXT: 'TEXT',
} as const;

export const NavigationMenuItemType = {
  OBJECT: 'OBJECT',
  VIEW: 'VIEW',
} as const;

export const PermissionFlag = {
  APPLICATIONS: 'APPLICATIONS',
} as const;

export const ViewKey = {
  INDEX: 'INDEX',
} as const;

export const ViewType = {
  TABLE: 'TABLE',
} as const;
