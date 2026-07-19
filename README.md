# LEGO Capture Generation

This branch adds a quality-first local generation mode that uses BrickGPT to propose several uncolored target shapes and then recompiles each target using only the selected physical inventory. The deterministic compiler owns final part, color, position, inventory, connectivity, and validation decisions.

The preview selects the committed fixed inventory by default: 787 pieces across 147 part/color rows and 32 rectangular brick/plate footprints.

## Local hybrid setup

BrickGPT is Python software built on the gated `meta-llama/Llama-3.2-1B-Instruct` model. Gemini and Backboard credentials are not required for hybrid generation.

1. Request access to [Llama 3.2 1B Instruct](https://huggingface.co/meta-llama/Llama-3.2-1B-Instruct) and create a Hugging Face access token.
2. Create a Python 3.10+ environment and install the [official BrickGPT package](https://github.com/AvaLovelace1/BrickGPT):

   ```bash
   python3 -m venv .venv-brickgpt
   .venv-brickgpt/bin/pip install "git+https://github.com/AvaLovelace1/BrickGPT.git@main"
   ```

3. Copy `.env.example` to `.env` and configure:

   ```dotenv
   GENERATION_MODE=brickgpt_inventory
   HF_TOKEN=your_hugging_face_token
   BRICKGPT_PYTHON=/absolute/path/to/.venv-brickgpt/bin/python
   BRICKGPT_USE_GUROBI=false
   ```

4. Check the local runtime without downloading or running a generation:

   ```bash
   npm run check:brickgpt
   ```

5. Start the preview and generation server:

   ```bash
   npm run dev
   ```

The first real generation downloads the BrickGPT/model files through Hugging Face and can take substantially longer than later runs. `BRICKGPT_CANDIDATE_COUNT` controls how many deterministic seeds are attempted. `HYBRID_COMPILER_BEAM_WIDTH` and `HYBRID_COMPILER_VARIANTS` trade additional local search time for more candidate layouts.

Gurobi is optional. Keep `BRICKGPT_USE_GUROBI=false` until the non-Gurobi path works. If enabled, install and license Gurobi according to the BrickGPT project instructions.

No Hugging Face token, model weights, Gurobi license, or generated runtime output should be committed.

## Verification without model access

The normal test suite uses a fake sidecar and never downloads model weights or calls an external API:

```bash
npm test
npm run build
```

The existing Gemini/Backboard path remains available with `GENERATION_MODE=legacy_ai` and its existing provider variables.
