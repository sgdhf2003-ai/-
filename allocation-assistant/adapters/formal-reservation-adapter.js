/**
 * FormalReservationAdapter Abstract Base Class (Pack 4A)
 */

class FormalReservationAdapter {
  syncReservation(syncRequest) {
    throw new Error('UNIMPLEMENTED_METHOD: FormalReservationAdapter.syncReservation must be implemented by subclass');
  }

  queryReservationStatus(holdIdempotencyKey) {
    throw new Error('UNIMPLEMENTED_METHOD: FormalReservationAdapter.queryReservationStatus must be implemented by subclass');
  }
}

module.exports = {
  FormalReservationAdapter
};
