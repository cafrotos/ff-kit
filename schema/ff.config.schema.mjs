// JSON Schema (draft-07) của ff.config.yaml. Sửa ở đây; không tách file .json.
export default {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": [
    "version",
    "workspace",
    "repos",
    "worker",
    "secrets"
  ],
  "additionalProperties": false,
  "definitions": {
    "cmd": {
      "type": "string",
      "minLength": 1
    },
    "relpath": {
      "type": "string",
      "minLength": 1
    }
  },
  "properties": {
    "version": {
      "const": 1
    },
    "workspace": {
      "type": "object",
      "required": [
        "root",
        "cards_dir",
        "worktrees_dir"
      ],
      "additionalProperties": false,
      "properties": {
        "root": {
          "$ref": "#/definitions/relpath"
        },
        "cards_dir": {
          "$ref": "#/definitions/relpath"
        },
        "worktrees_dir": {
          "$ref": "#/definitions/relpath"
        }
      }
    },
    "repos": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": [
          "name",
          "path",
          "base_branch",
          "ship_branch",
          "commands"
        ],
        "additionalProperties": false,
        "properties": {
          "name": {
            "type": "string",
            "pattern": "^[a-z0-9][a-z0-9_-]*$"
          },
          "path": {
            "$ref": "#/definitions/relpath"
          },
          "base_branch": {
            "type": "string",
            "minLength": 1
          },
          "ship_branch": {
            "type": "string",
            "minLength": 1
          },
          "commands": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "install": {
                "$ref": "#/definitions/cmd"
              },
              "lint": {
                "$ref": "#/definitions/cmd"
              },
              "typecheck": {
                "$ref": "#/definitions/cmd"
              },
              "build": {
                "$ref": "#/definitions/cmd"
              },
              "test": {
                "$ref": "#/definitions/cmd"
              },
              "migrate": {
                "$ref": "#/definitions/cmd"
              },
              "migrate_create": {
                "$ref": "#/definitions/cmd"
              }
            }
          },
          "env_files": {
            "type": "array",
            "items": {
              "$ref": "#/definitions/relpath"
            }
          }
        }
      }
    },
    "e2e": {
      "type": "object",
      "required": [
        "dir"
      ],
      "additionalProperties": false,
      "properties": {
        "dir": {
          "$ref": "#/definitions/relpath"
        },
        "playwright_config": {
          "$ref": "#/definitions/relpath"
        },
        "tests_dir": {
          "$ref": "#/definitions/relpath"
        },
        "done_tests_dir": {
          "$ref": "#/definitions/relpath"
        },
        "auth_storage": {
          "$ref": "#/definitions/relpath"
        },
        "apps": {
          "type": "array",
          "items": {
            "type": "object",
            "required": [
              "name",
              "base_url"
            ],
            "additionalProperties": false,
            "properties": {
              "name": {
                "type": "string",
                "pattern": "^[a-z0-9][a-z0-9_-]*$"
              },
              "base_url": {
                "type": "string",
                "pattern": "^https?://"
              }
            }
          }
        },
        "health_urls": {
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^https?://"
          }
        },
        "auth": {
          "type": "object",
          "required": [
            "strategy"
          ],
          "additionalProperties": false,
          "properties": {
            "strategy": {
              "enum": [
                "storage-state",
                "form-login",
                "jwt-mint",
                "none"
              ]
            },
            "login_url": {
              "type": "string",
              "pattern": "^https?://"
            },
            "jwt": {
              "type": "object",
              "required": [
                "secret",
                "algorithm",
                "payload",
                "deliver"
              ],
              "additionalProperties": false,
              "properties": {
                "secret": {
                  "type": "object",
                  "required": [
                    "file",
                    "key"
                  ],
                  "additionalProperties": false,
                  "properties": {
                    "file": {
                      "$ref": "#/definitions/relpath"
                    },
                    "key": {
                      "type": "string",
                      "pattern": "^[A-Za-z_][A-Za-z0-9_]*$"
                    }
                  }
                },
                "expires_in": {
                  "type": "object",
                  "additionalProperties": false,
                  "properties": {
                    "key": {
                      "type": "string"
                    },
                    "default": {
                      "type": "string",
                      "pattern": "^[0-9]+[smhd]$"
                    }
                  }
                },
                "algorithm": {
                  "enum": [
                    "HS256",
                    "HS384",
                    "HS512"
                  ]
                },
                "payload": {
                  "type": "object",
                  "minProperties": 1,
                  "additionalProperties": {
                    "type": "string"
                  }
                },
                "deliver": {
                  "type": "array",
                  "minItems": 1,
                  "items": {
                    "type": "object",
                    "required": [
                      "via",
                      "name"
                    ],
                    "additionalProperties": false,
                    "properties": {
                      "via": {
                        "enum": [
                          "query",
                          "local_storage",
                          "cookie"
                        ]
                      },
                      "name": {
                        "type": "string",
                        "minLength": 1
                      }
                    }
                  }
                },
                "verify": {
                  "type": "object",
                  "required": [
                    "url"
                  ],
                  "additionalProperties": false,
                  "properties": {
                    "url": {
                      "type": "string",
                      "pattern": "^https?://"
                    },
                    "expect_status": {
                      "type": "integer"
                    }
                  }
                },
                "user_lookup": {
                  "type": "string",
                  "minLength": 1
                }
              }
            }
          },
          "allOf": [
            {
              "if": {
                "properties": {
                  "strategy": {
                    "const": "form-login"
                  }
                }
              },
              "then": {
                "required": [
                  "login_url"
                ]
              }
            },
            {
              "if": {
                "properties": {
                  "strategy": {
                    "const": "jwt-mint"
                  }
                }
              },
              "then": {
                "required": [
                  "jwt"
                ]
              }
            }
          ]
        },
        "up_cmd": {
          "$ref": "#/definitions/cmd"
        },
        "down_cmd": {
          "$ref": "#/definitions/cmd"
        },
        "test_cmd": {
          "$ref": "#/definitions/cmd"
        }
      }
    },
    "project_docs": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "roles_file": {
          "$ref": "#/definitions/relpath"
        },
        "verification_queries_dir": {
          "$ref": "#/definitions/relpath"
        }
      }
    },
    "db": {
      "type": "object",
      "required": [
        "driver",
        "env_file"
      ],
      "additionalProperties": false,
      "properties": {
        "driver": {
          "enum": [
            "postgres",
            "mysql"
          ]
        },
        "env_file": {
          "$ref": "#/definitions/relpath"
        }
      }
    },
    "guard": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "protected_paths": {
          "type": "array",
          "items": {
            "$ref": "#/definitions/relpath"
          }
        },
        "allowed_bash": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "migration_script_re": {
          "type": "string",
          "minLength": 1
        },
        "forbidden_script_re": {
          "type": "string",
          "minLength": 1
        }
      }
    },
    "engine": {
      "type": "object",
      "required": [
        "default"
      ],
      "additionalProperties": false,
      "properties": {
        "default": {
          "type": "string",
          "minLength": 1
        },
        "commands": {
          "type": "object",
          "additionalProperties": {
            "type": "string"
          }
        }
      }
    },
    "worker": {
      "type": "object",
      "required": [
        "max_concurrent_tasks",
        "channel"
      ],
      "additionalProperties": false,
      "properties": {
        "max_concurrent_tasks": {
          "type": "integer",
          "minimum": 1,
          "maximum": 10
        },
        "task_source": {
          "type": "object",
          "required": [
            "adapter"
          ],
          "additionalProperties": false,
          "properties": {
            "adapter": {
              "enum": [
                "trello"
              ]
            },
            "trello": {
              "type": "object",
              "required": [
                "board_id",
                "poll_lists",
                "done_list"
              ],
              "additionalProperties": false,
              "properties": {
                "board_id": {
                  "type": "string",
                  "minLength": 1
                },
                "poll_lists": {
                  "type": "array",
                  "minItems": 1,
                  "items": {
                    "type": "string",
                    "minLength": 1
                  }
                },
                "done_list": {
                  "type": "string",
                  "minLength": 1
                },
                "poll_interval_sec": {
                  "type": "integer",
                  "minimum": 5
                },
                "filter_assigned_only": {
                  "type": "boolean"
                },
                "assignee": {
                  "type": "string",
                  "minLength": 1
                }
              }
            }
          },
          "if": {
            "properties": {
              "adapter": {
                "const": "trello"
              }
            }
          },
          "then": {
            "required": [
              "trello"
            ]
          }
        },
        "channel": {
          "type": "object",
          "required": [
            "adapter"
          ],
          "additionalProperties": false,
          "properties": {
            "adapter": {
              "enum": [
                "console",
                "rocketchat"
              ]
            }
          }
        },
        "tmux": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "session_name": {
              "type": "string",
              "pattern": "^[A-Za-z0-9_-]+$"
            },
            "session_prefix": {
              "type": "string",
              "pattern": "^[A-Za-z0-9_-]+$"
            },
            "cleanup_on_success": {
              "type": "boolean"
            },
            "cleanup_on_failure": {
              "type": "boolean"
            },
            "max_session_lifetime_hours": {
              "type": "number",
              "exclusiveMinimum": 0
            }
          }
        },
        "http": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "port": {
              "type": "integer",
              "minimum": 0,
              "maximum": 65535
            }
          }
        },
        "reload": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "watch": {
              "type": "boolean"
            },
            "debounce_ms": {
              "type": "integer",
              "minimum": 0
            }
          }
        }
      }
    },
    "secrets": {
      "type": "object",
      "required": [
        "env_file"
      ],
      "additionalProperties": false,
      "properties": {
        "env_file": {
          "$ref": "#/definitions/relpath"
        }
      }
    }
  }
}
