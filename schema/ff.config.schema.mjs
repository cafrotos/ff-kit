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
          "autopilot_deny_paths": {
            "type": "array",
            "items": { "type": "string", "minLength": 1 },
            "description": "Glob cấm bổ sung riêng cho repo này (cộng vào autopilot.deny_paths)."
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
          "description": "Thư mục duy nhất chứa test hành vi của thẻ đã xong (bộ hồi quy). Mặc định <tests_dir>/task-done.",
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
        "allowed_hosts": {
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^[A-Za-z0-9._-]+$"
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
        "services": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "object",
            "required": ["name", "repo", "cmd", "port"],
            "additionalProperties": false,
            "properties": {
              "name": { "type": "string", "pattern": "^[a-z0-9][a-z0-9_-]*$" },
              "repo": { "type": "string", "minLength": 1 },
              "cwd": { "$ref": "#/definitions/relpath" },
              "prepare": { "$ref": "#/definitions/cmd" },
              "cmd": { "$ref": "#/definitions/cmd" },
              "port": { "type": "integer", "minimum": 1, "maximum": 65535 },
              "env_load": { "type": "array", "items": { "$ref": "#/definitions/relpath" } },
              "health_url": { "type": "string", "pattern": "^https?://" },
              "env_overrides": {
                "type": "array",
                "items": {
                  "type": "object",
                  "required": ["file", "set"],
                  "additionalProperties": false,
                  "properties": {
                    "file": { "$ref": "#/definitions/relpath" },
                    "from": { "$ref": "#/definitions/relpath" },
                    "set": {
                      "type": "object",
                      "minProperties": 1,
                      "propertyNames": { "pattern": "^[A-Za-z_][A-Za-z0-9_]*$" },
                      "additionalProperties": { "type": "string" }
                    }
                  }
                }
              }
            }
          }
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
        "park_close_after_minutes": {
          "type": "integer",
          "minimum": 1,
          "default": 60
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
                "trello",
                "local"
              ]
            },
            "local": {
              "type": "object",
              "description": "Thẻ lưu thành file trong workspace (ff task create/list/show/move/comment); không cần Trello.",
              "required": [
                "poll_lists",
                "done_list"
              ],
              "additionalProperties": false,
              "properties": {
                "dir": {
                  "type": "string",
                  "minLength": 1,
                  "default": "ff-cards",
                  "description": "Thư mục thẻ, tương đối workspace, không '..' và không trong .ff/. Mỗi thẻ: <id>.md (front-matter id,title,list,labels,depends_on,created,updated + mô tả) và <id>.comments.jsonl."
                },
                "poll_lists": { "type": "array", "minItems": 1, "items": { "type": "string", "minLength": 1 } },
                "done_list": { "type": "string", "minLength": 1 },
                "poll_interval_sec": { "type": "integer", "minimum": 1 },
                "accept_list": { "type": "string", "pattern": "\\S" },
                "reopen_list": { "type": "string", "pattern": "\\S" },
                "park_list": { "type": "string", "pattern": "\\S" },
                "doing_list": { "type": "string", "pattern": "\\S" },
                "qa_fail_list": { "type": "string", "pattern": "\\S" }
              }
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
                  "type": "boolean",
                  "default": true
                },
                "assignee": {
                  "type": "string",
                  "minLength": 1
                },
                "accept_list": {
                  "type": "string",
                  "pattern": "\\S"
                },
                "reopen_list": {
                  "type": "string",
                  "pattern": "\\S"
                },
                "park_list": {
                  "type": "string",
                  "pattern": "\\S"
                },
                "doing_list": {
                  "type": "string",
                  "pattern": "\\S",
                  "description": "List 'Doing': thẻ trong list này được chạy trước. Mặc định: poll_list đầu tiên không khớp /qa.?fail/i."
                },
                "qa_fail_list": {
                  "type": "string",
                  "pattern": "\\S",
                  "description": "List 'QA Fail': chỉ nhận thẻ khi không còn thẻ Doing nào chờ chạy; thẻ được kéo về doing_list rồi mới sửa. Mặc định: poll_list đầu tiên khớp /qa.?fail/i."
                }
              }
            }
          },
          "allOf": [
            { "if": { "properties": { "adapter": { "const": "trello" } } }, "then": { "required": ["trello"] } },
            { "if": { "properties": { "adapter": { "const": "local" } } }, "then": { "required": ["local"] } }
          ]
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
            },
            "notify_level": {
              "enum": ["action", "all"],
              "default": "action",
              "description": "action: chỉ đẩy việc cần người (mặc định); all: đẩy mọi thông báo (vẫn chống trùng)."
            },
            "rocketchat": {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "thread_per_task": {
                  "type": "boolean",
                  "default": true
                }
              }
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
        },
        "driver": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "enabled": {
              "type": "boolean"
            },
            "remote_control": {
              "type": "boolean"
            },
            "stuck_after_minutes": {
              "type": "integer",
              "minimum": 1
            },
            "max_stage_retries": {
              "type": "integer",
              "minimum": 1
            },
            "max_repair_cycles": {
              "type": "integer",
              "minimum": 1,
              "maximum": 3
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
    },
    "ship": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "mode": {
          "enum": [
            "dev_only",
            "dev_and_pr"
          ]
        },
        "done_on": {
          "enum": [
            "pr",
            "base_branch",
            "either"
          ],
          "description": "Điều kiện kết thúc thẻ (WRK-10/12). pr (mặc định): PR đã merge (dev_and_pr) hoặc người xác nhận (dev_only). base_branch: thay đổi đã vào origin/<base_branch> (phát hiện bằng git: ancestor, patch-id, áp ngược), không cần PR/forge; dùng với mode dev_only cho workspace không có forge. either: PR merge hoặc đã vào base_branch."
        },
        "max_reopen": {
          "type": "integer",
          "minimum": 1
        },
        "verify_on_ship_branch": {
          "type": "boolean",
          "description": "Mặc định bắt buộc (true): verify chạy trên ff-test/<id> dựng bằng ff ship-test. Chỉ đặt false cho repo cũ không có ship branch."
        }
      }
    },
    "autopilot": {
      "type": "object",
      "additionalProperties": false,
      "description": "Chế độ tự lái (SRS 6.4): ff tự duyệt Gate A/B/C đủ điều kiện và ship lên ship_branch. Mặc định tắt.",
      "properties": {
        "enabled": { "type": "boolean", "description": "Công tắc tổng (mặc định false)." },
        "gate_a": { "enum": ["off", "shadow", "on"], "description": "Gate A tự qua: off, shadow (vẫn hỏi người, ghi dự đoán) hoặc on (mặc định)." },
        "ship": { "type": "boolean", "description": "Tự ship --auto khi Gate C auto_passed (mặc định true)." },
        "deny_paths": { "type": "array", "items": { "type": "string", "minLength": 1 }, "description": "Glob file mà autopilot không tự qua Gate C / tự ship khi diff chạm tới (mặc định: auth, payments, billing, permission/role/policy, .env, secrets, credentials, workflows, Docker, k8s, infra). Migration không bị cấm." },
        "daily_report_at": { "type": "string", "pattern": "^([01]\\d|2[0-3]):[0-5]\\d$", "description": "Giờ HH:MM gửi ff report --today qua kênh thông báo, mỗi ngày một lần." }
      }
    },
    "evolve": {
      "type": "object",
      "additionalProperties": false,
      "description": "Mức 5 (EVO): máy tự cải thiện skill. Chỉ đề xuất, không tự áp dụng.",
      "properties": {
        "min_cards": { "type": "integer", "minimum": 2, "description": "Số thẻ khác nhau cùng (skill, ngả lọt) để kích hoạt đề xuất (mặc định 2)." },
        "cooldown_days": { "type": "integer", "minimum": 0, "description": "Mỗi skill tối đa 1 đề xuất trong chừng này ngày (mặc định 7)." },
        "max_cases": { "type": "integer", "minimum": 1, "description": "Trần số ca eval mỗi đề xuất (mặc định 5)." },
        "repeat": { "type": "integer", "minimum": 1, "description": "Trần số lần lặp mỗi ca mỗi bản (mặc định 2)." },
        "timeout_sec": { "type": "integer", "minimum": 30, "description": "Timeout một lần chạy claude -p (mặc định 900)." },
        "permission_mode": { "enum": ["default", "acceptEdits", "plan", "bypassPermissions"], "description": "--permission-mode của lượt chạy eval (mặc định acceptEdits, workspace tạm)." }
      }
    },
    "knowledge": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "min_precedents": {
          "type": "integer",
          "minimum": 1
        },
        "dir": {
          "type": "string",
          "pattern": "\\S",
          "description": "Thư mục wiki nghiệp vụ (markdown) tương đối theo workspace, ngoài .ff/ (mặc định ff-wiki)."
        },
        "consolidate_min_cards": { "type": "integer", "minimum": 1, "description": "D2 hợp nhất khi có ≥ chừng này thẻ D1 mới kể từ lần D2 trước (mặc định 5)." },
        "consolidate_min_days": { "type": "integer", "minimum": 0, "description": "...và đã qua ≥ chừng này ngày (mặc định 7)." },
        "runner": { "enum": ["claude", "opencode"], "description": "Runner LLM cho dreaming (mặc định claude). opencode chỉ chạy cho repo trong cheap_lane_repos." },
        "model": { "type": "string", "pattern": "\\S", "description": "--model cho claude -p của dreaming (mặc định: model mặc định của Claude Code)." },
        "cheap_lane_repos": { "type": "array", "items": { "type": "string", "pattern": "\\S" }, "description": "Repo được phép dùng làn rẻ (opencode). Cẩn trọng: code rời khỏi máy theo nhà cung cấp opencode; mặc định rỗng." },
        "dream": {
          "type": "object",
          "additionalProperties": false,
          "description": "Lập lịch dreaming trong cửa sổ rảnh (ff-worker).",
          "properties": {
            "enabled": { "type": "boolean", "description": "Bật việc tốn LLM (D0/D0'/D1/D2/evolve) trong worker (mặc định false)." },
            "fetch_interval_min": { "type": "integer", "minimum": 1, "description": "git fetch origin <base_branch> tối đa mỗi chừng này phút (mặc định 15)." },
            "max_attempts": { "type": "integer", "minimum": 1, "description": "Số lần thử tối đa mỗi việc (mặc định 3)." },
            "backoff_min": { "type": "integer", "minimum": 1, "description": "Chờ sau lần lỗi đầu, nhân 4 mỗi lần (mặc định 5 phút)." }
          }
        },
        "quota": {
          "type": "object",
          "additionalProperties": false,
          "description": "Cổng quota cho việc dreaming (đọc cswap list --json).",
          "properties": {
            "five_hour_max": { "type": "number", "minimum": 0, "maximum": 100, "description": "Chỉ chạy khi % dùng 5 giờ < ngưỡng (mặc định 50)." },
            "seven_day_max": { "type": "number", "minimum": 0, "maximum": 100, "description": "Chỉ chạy khi % dùng 7 ngày < ngưỡng (mặc định 70)." },
            "max_age_sec": { "type": "integer", "minimum": 1, "description": "Số liệu cswap cũ hơn thì coi như không rõ, không chạy (mặc định 900)." },
            "allowed_hours": { "type": "string", "pattern": "^\\d{1,2}-\\d{1,2}$", "description": "Khi không có cswap: giờ máy được chạy, vd 1-6 hoặc 22-6 (mặc định 1-6)." },
            "cswap_bin": { "type": "string", "pattern": "\\S", "description": "Lệnh cswap (mặc định cswap)." }
          }
        },
        "job_timeout_sec": {
          "type": "object",
          "additionalProperties": false,
          "description": "Timeout (giây) mỗi loại việc dreaming.",
          "properties": {
            "D0": { "type": "integer", "minimum": 30 }, "D0p": { "type": "integer", "minimum": 30 }, "D1": { "type": "integer", "minimum": 30 }, "D2": { "type": "integer", "minimum": 30 }, "evolve": { "type": "integer", "minimum": 30 }
          }
        },
        "shadow_window": {
          "type": "integer",
          "minimum": 1,
          "description": "Số lần dự đoán gần nhất xét độ khớp theo lớp+repo (mặc định 10)."
        },
        "shadow_min_match": {
          "type": "integer",
          "minimum": 1,
          "description": "Số lần khớp tối thiểu trong cửa sổ để lớp được tự quyết (mặc định 9)."
        },
        "high_risk": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "repo": {
                "type": "string",
                "pattern": "\\S"
              },
              "keywords": {
                "type": "array",
                "items": {
                  "type": "string",
                  "pattern": "\\S"
                }
              },
              "paths": {
                "type": "array",
                "items": {
                  "type": "string",
                  "pattern": "\\S"
                }
              }
            },
            "anyOf": [
              {
                "required": [
                  "keywords"
                ],
                "properties": {
                  "keywords": {
                    "minItems": 1,
                    "type": "array"
                  }
                }
              },
              {
                "required": [
                  "paths"
                ],
                "properties": {
                  "paths": {
                    "minItems": 1,
                    "type": "array"
                  }
                }
              }
            ]
          }
        }
      }
    }
  }
}
