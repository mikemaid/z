{
  "app": "npx ts-node --prefer-ts-exts bin/pipeline.ts",
  "context": {
    "@aws-cdk/core:newStyleStackSynthesis": true
  },
  "watch": {
    "include": "lib",
    "exclude": [
      "cdk.out",
      "node_modules"
    ]
  }
}