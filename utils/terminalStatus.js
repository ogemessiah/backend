const mapTerminalStatus = (terminalStatus) => {

  const status = String(
    terminalStatus || ''
  )
    .toLowerCase()
    .trim();

  switch (status) {

    case 'pending':
    case 'confirmed':
      return 'confirmed';

    case 'picked_up':
    case 'picked-up':
    case 'picked up':
      return 'picked_up';

    case 'in-transit':
    case 'in_transit':
    case 'in transit':
      return 'in_transit';

    case 'delivered':
      return 'delivered';

    case 'cancelled':
    case 'canceled':
      return 'cancelled';

    case 'failed':
      return 'failed';

    default:
      return 'confirmed';
  }
};


module.exports = {
  mapTerminalStatus
};