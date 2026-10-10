#!/usr/bin/env python3
"""Operator-only Bunny CDN secret provisioning; never reads credentials from other apps."""
import argparse
import getpass
import json
import re
import subprocess
import sys

NAMESPACE = "moc-maria"
DEPLOYMENT = "moc-maria-api"
SECRET = "moc-maria-bunny-media"
IMAGE_PREFIX = "ghcr.io/hopdevnbi/moc_maria_be@sha256:"


def kube(arguments, payload=None, missing_ok=False):
    result = subprocess.run(
        ["kubectl", "-n", NAMESPACE, *arguments],
        input=payload, capture_output=True, text=True, check=False,
    )
    if result.returncode:
        if missing_ok and "NotFound" in result.stderr:
            return None
        # Do not print stderr from Secret operations: it may include submitted data.
        raise RuntimeError("Kubernetes command failed: " + arguments[0])
    return result.stdout.strip()


def image():
    value = kube(["get", "deployment", DEPLOYMENT,
                  "-o", "jsonpath={.spec.template.spec.containers[0].image}"])
    if not value or not value.startswith(IMAGE_PREFIX):
        raise RuntimeError("Wrong deployment image; refusing changes.")
    return value


def secret_version():
    return kube(["get", "secret", SECRET, "-o",
                 "jsonpath={.metadata.resourceVersion}"], missing_ok=True)


def setup(zone, cdn, region):
    if not re.fullmatch(r"[a-zA-Z0-9_-]{2,100}", zone):
        raise ValueError("Invalid storage zone name.")
    if not re.fullmatch(r"https://[a-zA-Z0-9.-]+", cdn):
        raise ValueError("CDN URL must be an HTTPS origin with no path.")
    if not re.fullmatch(r"[a-z0-9-]{2,30}", region):
        raise ValueError("Invalid region.")
    before = image()
    print("Target:", NAMESPACE + "/" + DEPLOYMENT)
    print("Zone:", zone, "CDN:", cdn, "Region:", region)
    if input("Type CONFIGURE to continue: ").strip() != "CONFIGURE":
        print("Cancelled; no changes were made.")
        return
    key = getpass.getpass("Bunny Storage write key (hidden input): ").strip()
    if len(key) < 12:
        raise ValueError("Missing or invalid authorized write key.")
    obj = {
        "apiVersion": "v1", "kind": "Secret", "type": "Opaque",
        "metadata": {"name": SECRET, "namespace": NAMESPACE},
        "stringData": {
            "BUNNY_STORAGE_ZONE": zone,
            "BUNNY_STORAGE_API_KEY": key,
            "BUNNY_STORAGE_CDN_URL": cdn,
            "BUNNY_STORAGE_REGION": region,
        },
    }
    version = secret_version()
    if version:
        obj["metadata"]["resourceVersion"] = version
        kube(["replace", "-f", "-"], json.dumps(obj))
    else:
        kube(["create", "-f", "-"], json.dumps(obj))
    print("Dedicated Secret saved. No credentials printed.")
    kube(["set", "env", "deployment/" + DEPLOYMENT, "--from=secret/" + SECRET])
    kube(["rollout", "restart", "deployment/" + DEPLOYMENT])
    kube(["rollout", "status", "deployment/" + DEPLOYMENT, "--timeout=180s"])
    if image() != before:
        raise RuntimeError("Concurrent image change detected; review the deployment.")
    print("Deployment ready. Verify the authenticated avatar upload in your browser.")


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--status", action="store_true")
    p.add_argument("--zone", default="giangxa-media")
    p.add_argument("--cdn", default="https://giangxa-media-cdn.b-cdn.net")
    p.add_argument("--region", default="sg")
    a = p.parse_args()
    try:
        if a.status:
            print("Deployment image:", image())
            print("Dedicated CDN Secret:", "present" if secret_version() else "not configured")
        else:
            setup(a.zone, a.cdn, a.region)
    except (RuntimeError, ValueError, OSError) as exc:
        print("Configuration failed:", exc, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
