{
  pkgs ? import <nixpkgs> { },
  nodejs ? pkgs.nodejs,
}:

let
  src = ./..;
  node_modules = pkgs.importNpmLock.buildNodeModules {
    npmRoot = src;
    inherit nodejs;
  };
in
pkgs.stdenv.mkDerivation {
  pname = "rsvpub";
  version = "0.1.0";
  inherit src;

  nativeBuildInputs = [
    nodejs
    pkgs.makeWrapper
  ];

  buildPhase = ''
    runHook preBuild

    export HOME=$(mktemp -d)
    ln -s ${node_modules}/node_modules .
    npm run build

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/lib/rsvpub
    mkdir -p $out/bin

    # Copy built files
    cp -r dist $out/lib/rsvpub/
    cp -r server $out/lib/rsvpub/
    cp -r public $out/lib/rsvpub/
    cp package.json $out/lib/rsvpub/

    # Link node_modules
    ln -s ${node_modules}/node_modules $out/lib/rsvpub/node_modules

    # Create wrapper script
    makeWrapper ${nodejs}/bin/node $out/bin/rsvpub \
      --add-flags "--import tsx" \
      --add-flags "$out/lib/rsvpub/server/index.ts" \
      --set NODE_ENV production \
      --set NODE_PATH "${node_modules}/node_modules" \
      --chdir $out/lib/rsvpub

    runHook postInstall
  '';

  meta = with pkgs.lib; {
    description = "RSVP speed reading web application for EPUBs";
    homepage = "https://github.com/vinnymeller/rsvpub";
    license = licenses.mit;
    platforms = platforms.linux ++ platforms.darwin;
  };
}
