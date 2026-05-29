# Installer NATS JetStream sur GKE Autopilot

Après `terraform apply` du module `nats/`, installer avec Helm :

```bash
gcloud container clusters get-credentials messaging-staging-nats --region europe-west1

helm repo add nats https://nats-io.github.io/k8s/helm/charts/
helm repo update

helm install nats nats/nats \
  --set config.jetstream.enabled=true \
  --set config.jetstream.fileStore.pvc.size=20Gi \
  --set config.jetstream.fileStore.pvc.storageClassName=premium-rwo \
  --set config.cluster.enabled=true \
  --set config.cluster.replicas=3 \
  --set podTemplate.merge.spec.serviceAccountName=nats
```

Vérifier :
```bash
kubectl get pods -l app.kubernetes.io/name=nats
kubectl exec -it nats-0 -- nats stream ls
```

Côté Cloud Run, configurer :
```
NATS_URL=nats://nats.default.svc.cluster.local:4222
```
(le VPC connector du module network/ permet à Cloud Run d'atteindre le DNS interne du cluster).
