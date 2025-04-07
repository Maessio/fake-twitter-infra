import { Stack, StackProps, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';

export class FakeTwitterStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // VPC
    const vpc = new ec2.Vpc(this, 'FakeTwitterVpc', { maxAzs: 2 });

    // S3 Bucket for frontend
    const siteBucket = new s3.Bucket(this, 'FrontendBucket', {
      bucketName: 'fake-twitter-frontend-teste',
      websiteIndexDocument: 'index.html',
      publicReadAccess: false,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Create CloudFront Origin Access Identity (OAI)
    const oai = new cloudfront.OriginAccessIdentity(this, 'OAI');

    // Grant CloudFront access to the S3 bucket
    siteBucket.grantRead(oai);

    // CloudFront Distribution
    const distribution = new cloudfront.Distribution(this, 'FrontendDistribution', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: new origins.S3Origin(siteBucket, {
          originAccessIdentity: oai,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
    });

    // Update the bucket policy to allow CloudFront access using the OAI ID
    siteBucket.addToResourcePolicy(new cdk.aws_iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [
        siteBucket.arnForObjects('*')
      ],
      principals: [new cdk.aws_iam.ArnPrincipal(`arn:aws:iam::cloudfront:user/CloudFront Origin Access Identity ${oai.originAccessIdentityId}`)],
    }));

    // RDS PostgreSQL
    const db = new rds.DatabaseInstance(this, 'PostgresInstance', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15,
      }),
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
      deletionProtection: false,
    });

    const dbSecret = db.secret!;

    // ECS Cluster
    const cluster = new ecs.Cluster(this, 'FakeTwitterCluster', { vpc });

    // Task Definition
    const taskDef = new ecs.FargateTaskDefinition(this, 'BackendTaskDef', {
      memoryLimitMiB: 512,
      cpu: 256,
    });

    // ECR Repo
    const backendRepo = new ecr.Repository(this, 'BackendRepo', {
      repositoryName: 'fake-twitter-backend',
    });

    const container = taskDef.addContainer('BackendContainer', {
      image: ecs.ContainerImage.fromEcrRepository(backendRepo),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'backend' }),
      environment: {
        SPRING_DATASOURCE_URL: `jdbc:postgresql://${db.dbInstanceEndpointAddress}:5432/fake_twitter_db`,
        JWT_SECRET: 'my-secret-key',
      },
      secrets: {
        SPRING_DATASOURCE_USERNAME: ecs.Secret.fromSecretsManager(dbSecret, 'username'),
        SPRING_DATASOURCE_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, 'password'),
      },
      portMappings: [{ containerPort: 8080 }],
    });

    // Fargate Service with Load Balancer
    const backendService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'BackendService', {
      cluster,
      taskDefinition: taskDef,
      desiredCount: 2,
      publicLoadBalancer: true,
      listenerPort: 80
    });

    // health check with load balancer
    backendService.targetGroup.configureHealthCheck({
      path: '/health',
      healthyHttpCodes: '200',
      interval: cdk.Duration.seconds(30),
      timeout: cdk.Duration.seconds(5),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 3
    });

    // Security Group
    const dbSecurityGroup = db.connections.securityGroups[0];
    const backendSecurityGroup = backendService.service.connections.securityGroups[0];

    dbSecurityGroup.addIngressRule(
      backendSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow ECS backend to access RDS PostgreSQL'
    );
    

    // Outputs
    new cdk.CfnOutput(this, 'FrontendURL', {
      value: distribution.domainName,
    });

    new cdk.CfnOutput(this, 'BackendURL', {
      value: backendService.loadBalancer.loadBalancerDnsName,
    });
  }
}
