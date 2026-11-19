#include <eosio/eosio.hpp>
#include <eosio/crypto.hpp>
#include <eosio/transaction.hpp>
#include <tuple>
#include <cstdint>

using namespace eosio;

class [[eosio::contract("rngtest")]] rngtest : public contract {
public:
    using contract::contract;

    struct [[eosio::table]] roll_row {
        uint64_t roll_id;
        name player;
        time_point_sec requested_at;
        time_point_sec fulfilled_at;
        uint64_t orng_request_id;
        checksum256 random_value;
        bool fulfilled;

        uint64_t primary_key() const { return roll_id; }
    };

    using rolls_table = multi_index<"rolls"_n, roll_row>;

    [[eosio::action]]
    void roll(name player) {
        require_auth(player);

        rolls_table rolls(get_self(), get_self().value);
        const uint64_t roll_id = rolls.available_primary_key();

        const checksum256 tx_hash = get_transaction_hash();
        const uint64_t signing_value = hash_to_u64(tx_hash);

        rolls.emplace(player, [&](auto& row) {
            row.roll_id = roll_id;
            row.player = player;
            row.requested_at = time_point_sec(current_time_point());
            row.fulfilled_at = time_point_sec(0);
            row.orng_request_id = 0;
            row.random_value = checksum256{};
            row.fulfilled = false;
        });

        action(
            permission_level{get_self(), "orng"_n},
            "orng.wax"_n,
            "requestrand"_n,
            std::make_tuple(roll_id, signing_value, get_self())
        ).send();
    }

    [[eosio::on_notify("orng.wax::randnotify")]]
    void on_random(uint64_t request_id,
                   name dapp,
                   uint64_t assoc_id,
                   const checksum256& random_value) {
        check(dapp == get_self(), "ORNG notification is for another dApp");

        rolls_table rolls(get_self(), get_self().value);
        auto itr = rolls.find(assoc_id);
        check(itr != rolls.end(), "Pending roll not found");
        check(!itr->fulfilled, "Roll already fulfilled");

        rolls.modify(itr, same_payer, [&](auto& row) {
            row.orng_request_id = request_id;
            row.random_value = random_value;
            row.fulfilled = true;
            row.fulfilled_at = time_point_sec(current_time_point());
        });
    }

private:
    static checksum256 get_transaction_hash() {
        const size_t size = transaction_size();
        char buffer[size];
        const uint32_t read = read_transaction(buffer, size);
        check(read == size, "read_transaction() failed");
        return sha256(buffer, read);
    }

    static uint64_t hash_to_u64(const checksum256& hash) {
        const auto bytes = hash.extract_as_byte_array();
        uint64_t result = 0;
        for (uint32_t i = 0; i < 8; ++i) {
            result = (result << 8) | bytes[i];
        }
        return result;
    }
};
