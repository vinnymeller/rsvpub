{ config, lib, pkgs, ... }:

let
  cfg = config.services.rsvpub;
  configFile = pkgs.writeText "rsvpub-config.json" (builtins.toJSON {
    server = {
      port = cfg.port;
      host = cfg.host;
    };
    storage = {
      dataDir = cfg.dataDir;
    };
  });
in
{
  options.services.rsvpub = {
    enable = lib.mkEnableOption "RSVPub speed reading service";

    port = lib.mkOption {
      type = lib.types.port;
      default = 7787;
      description = "Port to listen on";
    };

    host = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "Host/IP to bind to";
    };

    dataDir = lib.mkOption {
      type = lib.types.str;
      default = "/var/lib/rsvpub";
      description = "Directory for storing books and database";
    };

    openFirewall = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Whether to open the firewall for the service port";
    };

    package = lib.mkOption {
      type = lib.types.package;
      description = "The rsvpub package to use (from the flake)";
      example = lib.literalExpression "inputs.rsvpub.packages.\${system}.default";
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.services.rsvpub = {
      description = "RSVPub Speed Reading Service";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];

      serviceConfig = {
        Type = "simple";
        ExecStart = "${cfg.package}/bin/rsvpub --config ${configFile}";
        DynamicUser = true;
        StateDirectory = "rsvpub";
        Restart = "on-failure";
        RestartSec = 5;

        # Hardening
        NoNewPrivileges = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        PrivateTmp = true;
        ReadWritePaths = [ cfg.dataDir ];
      };

      environment = {
        NODE_ENV = "production";
      };
    };

    networking.firewall.allowedTCPPorts = lib.mkIf cfg.openFirewall [ cfg.port ];
  };
}
