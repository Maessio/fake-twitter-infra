#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { FakeTwitterStack } from '../lib/fake-twitter-stack';

const app = new cdk.App();

new FakeTwitterStack(app, 'FakeTwitterStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});
