#:: lumine-demo
# %% Prepare samples
import numpy as np

samples = np.array([0.2, 0.8, -0.4, 0.5, 1.0])
mean = samples.mean()
peak = np.abs(samples).max()

# %% Inspect the signal
print(f"Mean amplitude: {mean:.2f}")
print(f"Peak amplitude: {peak:.2f}")
samples
