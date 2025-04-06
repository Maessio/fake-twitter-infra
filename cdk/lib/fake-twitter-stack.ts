// cdk/lib/fake-twitter-stack.ts
import { Stack, StackProps, RemovalPolicy  } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';

export class FakeTwitterStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // VPC
    const vpc = new ec2.Vpc(this, 'FakeTwitterVpc', { maxAzs: 2 });

    // S3 Bucket for frontend
    const siteBucket = new s3.Bucket(this, 'FrontendBucket', {
      websiteIndexDocument: 'index.html',
      publicReadAccess: false,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true
    });

    // CloudFront Distribution
    const distribution = new cloudfront.Distribution(this, 'FrontendDistribution', {
      defaultBehavior: {
        origin: new origins.S3StaticWebsiteOrigin(siteBucket)
      }
    });

    // Frontend deploy (opcional, útil para testes locais)
    new s3deploy.BucketDeployment(this, 'DeployFrontend', {
      sources: [s3deploy.Source.asset('../fake-twitter-frontend/dist/fake-twitter-frontend')],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*']
    });

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

    // ECS Cluster
    const cluster = new ecs.Cluster(this, 'FakeTwitterCluster', { vpc });

    // Task Definition
    const taskDef = new ecs.FargateTaskDefinition(this, 'BackendTaskDef', {
      memoryLimitMiB: 512,
      cpu: 256
    });

    taskDef.addContainer('BackendContainer', {
      image: ecs.ContainerImage.fromEcrRepository(
        ecr.Repository.fromRepositoryName(this, 'BackendRepo', 'fake-twitter-backend')
      ),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'backend' }),
      environment: {
        DATABASE_URL: `jdbc:postgresql://${db.dbInstanceEndpointAddress}:5432/fake_twitter_db`
      }
    });

    // Fargate Service with Load Balancer
    const service = new ecs.FargateService(this, 'BackendService', {
      cluster,
      taskDefinition: taskDef,
      desiredCount: 2
    });

    const lb = new elbv2.ApplicationLoadBalancer(this, 'LB', {
      vpc,
      internetFacing: true
    });

    const listener = lb.addListener('Listener', {
      port: 80,
      open: true
    });

    listener.addTargets('ECS', {
      port: 80,
      targets: [service]
    });

    // Output useful URLs
    new cdk.CfnOutput(this, 'FrontendURL', {
      value: distribution.distributionDomainName
    });

    new cdk.CfnOutput(this, 'BackendURL', {
      value: lb.loadBalancerDnsName
    });
  }
}
