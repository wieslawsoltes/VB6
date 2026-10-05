# Temporary integration of the reviewed main revision. Generated bundles are
# rebuilt by the feature workflow; handwritten conflicts must be reviewed.
import subprocess

def git(*args, **kwargs):
    return subprocess.run(['git',*args],text=True,**kwargs)

git('config','user.name','github-actions[bot]',check=True)
git('config','user.email','41898282+github-actions[bot]@users.noreply.github.com',check=True)
git('fetch','origin','5f64aea7b9b54d90043096a90128439399da9615',check=True)
result=git('merge','--no-commit','--no-ff','5f64aea7b9b54d90043096a90128439399da9615')
conflicts=git('diff','--name-only','--diff-filter=U',capture_output=True,check=True).stdout.splitlines()
if result.returncode and not conflicts:
    raise RuntimeError('Merge failed before conflict resolution')
for path in conflicts:
    if not (path.startswith('dist/') or path=='src/exporter/runtime-payload.js'):
        raise RuntimeError('Handwritten source conflict requires review: '+path)
    git('checkout','--ours','--',path,check=True)
    git('add','--',path,check=True)
