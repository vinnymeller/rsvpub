{
  description = "RSVPub - Speed reading web application for EPUBs";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    systems.url = "github:nix-systems/default";
  };

  outputs =
    {
      self,
      nixpkgs,
      systems,
    }:
    let
      inherit (nixpkgs) lib;
      eachSystem = lib.genAttrs (import systems);
      pkgsFor = eachSystem (system: import nixpkgs { inherit system; });
    in
    {
      packages = eachSystem (
        system:
        let
          pkgs = pkgsFor.${system};
        in
        {
          default = pkgs.callPackage ./nix/package.nix { };
          rsvpub = self.packages.${system}.default;
        }
      );

      nixosModules = {
        default = import ./nix/module.nix;
        rsvpub = self.nixosModules.default;
      };

      devShells = eachSystem (
        system:
        let
          pkgs = pkgsFor.${system};
        in
        {
          default = pkgs.mkShell {
            name = "rsvpub-dev-shell";
            packages = [
              pkgs.nodejs
              pkgs.importNpmLock.hooks.linkNodeModulesHook
            ];

            npmDeps = pkgs.importNpmLock.buildNodeModules {
              npmRoot = ./.;
              inherit (pkgs) nodejs;
            };
          };
        }
      );
    };
}
