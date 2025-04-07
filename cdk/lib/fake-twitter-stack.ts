// cdk/lib/fake-twitter-stack.ts
import { Stack, StackProps, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as iam from 'aws-cdk-lib/aws-iam';

export class FakeTwitterStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // VPC
    const vpc = new ec2.Vpc(this, 'FakeTwitterVpc', { maxAzs: 2 });

    // S3 Bucket for frontend
    const siteBucket = new s3.Bucket(this, 'FrontendBucket', {
      bucketName: "fake-twitter-frontend",
      websiteIndexDocument: 'index.html',
      publicReadAccess: false,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true
    });

    // Origin Access Control for CloudFront
    const oac = new cloudfront.CfnOriginAccessControl(this, 'FakeTwitterOAC', {
      originAccessControlConfig: {
        name: 'FakeTwitterOAC',
        originAccessControlOriginType: 's3',
        signingBehavior: 'always',
        signingProtocol: 'sigv4',
        description: 'OAC for CloudFront to access S3'
      }
    });

    // CloudFront Distribution with OAC
    const distribution = new cloudfront.CfnDistribution(this, 'FrontendDistribution', {
      distributionConfig: {
        enabled: true,
        defaultRootObject: 'index.html',
        origins: [
          {
            id: 'FakeTwitterOrigin',
            domainName: siteBucket.bucketRegionalDomainName,
            originAccessControlId: oac.attrId,
            s3OriginConfig: { originAccessIdentity: '' }
          }
        ],
        defaultCacheBehavior: {
          targetOriginId: 'FakeTwitterOrigin',
          viewerProtocolPolicy: 'redirect-to-https',
          allowedMethods: ['GET', 'HEAD'],
          cachedMethods: ['GET', 'HEAD'],
          compress: true,
          forwardedValues: {
            queryString: false,
            cookies: { forward: 'none' }
          }
        }
      }
    });

    // Grant CloudFront access to the bucket
    siteBucket.addToResourcePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [siteBucket.arnForObjects('*')],
      principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
      conditions: {
        StringEquals: {
          'AWS:SourceArn': `arn:aws:cloudfront::${this.account}:distribution/${distribution.ref}`
        }
      }
    }));

    // RDS PostgreSQL
    const db = new rds.DatabaseInstance(this, 'PostgresInstance', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_15 }),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      publiclyAccessible: false,
      credentials: rds.Credentials.fromGeneratedSecret('postgres'),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      multiAz: false,
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      databaseName: 'fake_twitter_db',
      removalPolicy: RemovalPolicy.DESTROY,
      deletionProtection: false
    });

    const dbSecret = db.secret!;

    // ECS Cluster
    const cluster = new ecs.Cluster(this, 'FakeTwitterCluster', { vpc });

    // Task Definition
    const taskDef = new ecs.FargateTaskDefinition(this, 'BackendTaskDef', {
      memoryLimitMiB: 512,
      cpu: 256
    });

    const backendRepo = new ecr.Repository(this, 'BackendRepo', {
      repositoryName: 'fake-twitter-backend'
    });

    const container = taskDef.addContainer('BackendContainer', {
      image: ecs.ContainerImage.fromEcrRepository(backendRepo),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'backend' }),
      environment: {
        SPRING_DATASOURCE_URL: `jdbc:postgresql://${db.dbInstanceEndpointAddress}:5432/fake_twitter_db`,
        JWT_SECRET: 'my-secret-key'
      },
      secrets: {
        SPRING_DATASOURCE_USERNAME: ecs.Secret.fromSecretsManager(dbSecret, 'username'),
        SPRING_DATASOURCE_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, 'password')
      },
      portMappings: [{ containerPort: 8080 }]
    });

    // Fargate Service with Load Balancer
    const backendService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'BackendService', {
      cluster,
      taskDefinition: taskDef,
      desiredCount: 2,
      publicLoadBalancer: true,
      listenerPort: 80
    });

    // Output useful URLs
    new cdk.CfnOutput(this, 'FrontendURL', {
      value: distribution.attrDomainName
    });

    new cdk.CfnOutput(this, 'BackendURL', {
      value: backendService.loadBalancer.loadBalancerDnsName
    });
  }
}
