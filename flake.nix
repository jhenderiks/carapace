{
  inputs = {
    flake-utils.url = "github:numtide/flake-utils";
    nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";
    nixpkgs-stable.url = "github:nixos/nixpkgs/nixos-25.11";
  };

  outputs =
    {
      self,
      flake-utils,
      nixpkgs,
      nixpkgs-stable,
      ...
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
        pkgs-stable = import nixpkgs-stable { inherit system; };
      in
      {
        devShell = pkgs.mkShell {
          name = "carapace";

          buildInputs = with pkgs; [
            bun
            openssl
          ];
        };
      }
    );
}
