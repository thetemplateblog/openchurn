# openchurn

Plan bank sign-up bonuses around one paycheck, on your own computer. Your plan is a file you own.

```sh
npx openchurn                  # saves to ~/OpenChurn/plan.json
npx openchurn ./my-plan.json   # or a file you choose
```

Option: `--port 4580`. It prints a link to open in your browser. The server listens on `127.0.0.1` only and only reads and writes the one plan file.

More at [github.com/thetemplateblog/openchurn](https://github.com/thetemplateblog/openchurn). MIT licensed.
