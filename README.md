Fake Twitter - Infrastructure
This repository contains the infrastructure setup for the Fake Twitter project, utilizing AWS Cloud Development Kit (CDK) to provision cloud resources, including a VPC, S3, CloudFront, RDS, ECS, and other services necessary for deploying the application. Additionally, it provides a Docker Compose setup for local development and testing, allowing you to run the infrastructure locally for testing purposes.

Infrastructure Overview
This setup provisions the following resources on AWS:

VPC: A Virtual Private Cloud (VPC) with two availability zones.

S3 Bucket: An S3 bucket to host the frontend assets, integrated with CloudFront for content delivery.

CloudFront: A CloudFront distribution with an Origin Access Identity (OAI) to serve the frontend assets securely.

RDS PostgreSQL: A PostgreSQL database instance for storing application data, configured with automatic secrets management.

ECS Fargate: A containerized backend service using ECS Fargate with auto-scaling, deployed behind an Application Load Balancer.

ECR: An Elastic Container Registry (ECR) repository to store the Docker image for the backend.

This stack is designed to be flexible and easily deployed with AWS CDK, while Docker Compose is available for local testing.

Prerequisites

AWS CDK: To deploy and manage cloud resources.

Docker: To run local development containers.

Docker Compose: For managing multi-container Docker applications.

Node.js and npm: Required for AWS CDK.

Setup
Clone the Repository

Install Dependencies

npm install

In the root directory of the repository, run the following command to bring up the necessary services (backend, database, etc.):

docker-compose up --build

You can access the frontend service at http://localhost:4200.

Deploy Infrastructure to AWS
To deploy the infrastructure to AWS, follow these steps:

Bootstrap the AWS CDK (if you haven't already done so):

cdk bootstrap

To deploy the infrastructure, run the following command:

cdk deploy

Once the infrastructure is deployed, the following outputs will be provided:

Frontend URL: The URL for the CloudFront distribution serving the frontend.

Backend URL: The URL for the ECS Fargate service, which serves the backend API.

To tear down the infrastructure, run:

cdk destroy