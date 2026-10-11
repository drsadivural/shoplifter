#!/usr/bin/env python3
"""Real WS-Discovery Probe from a specified local IPv4 interface. Discovery only."""
import argparse,ipaddress,json,socket,time,uuid,xml.etree.ElementTree as ET
GROUP=('239.255.255.250',3702)
def discover(interface,timeout=5):
    ip=ipaddress.ip_address(interface)
    if ip.version!=4 or ip.is_multicast or ip.is_unspecified:raise ValueError('A local unicast IPv4 address is required')
    if not 0<timeout<=30:raise ValueError('Timeout must be between 0 and 30 seconds')
    ident='urn:uuid:'+str(uuid.uuid4())
    message=f'''<?xml version="1.0"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:dn="http://www.onvif.org/ver10/network/wsdl"><s:Header><a:MessageID>{ident}</a:MessageID><a:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</a:To><a:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</a:Action></s:Header><s:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></s:Body></s:Envelope>'''.encode()
    results={};deadline=time.monotonic()+timeout
    with socket.socket(socket.AF_INET,socket.SOCK_DGRAM,socket.IPPROTO_UDP) as sock:
        sock.bind((interface,0));sock.setsockopt(socket.IPPROTO_IP,socket.IP_MULTICAST_IF,socket.inet_aton(interface));sock.setsockopt(socket.IPPROTO_IP,socket.IP_MULTICAST_TTL,1)
        sock.sendto(message,GROUP);sock.settimeout(min(.5,timeout))
        while time.monotonic()<deadline:
            try:data,addr=sock.recvfrom(65535)
            except socket.timeout:continue
            # Reject DTD/entity payloads. Responses and destination URLs remain untrusted.
            if b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():continue
            try:root=ET.fromstring(data)
            except ET.ParseError:continue
            relates=root.find('.//{http://schemas.xmlsoap.org/ws/2004/08/addressing}RelatesTo')
            if relates is None or relates.text!=ident:continue
            for match in root.findall('.//{http://schemas.xmlsoap.org/ws/2005/04/discovery}ProbeMatch'):
                def vals(name):return [e.text or '' for e in match.iter() if e.tag.split('}')[-1]==name]
                endpoints=vals('Address');urls=vals('XAddrs');scopes=vals('Scopes')
                if not endpoints:continue
                results[endpoints[0]]={'endpoint':endpoints[0],'source_ip':addr[0],'xaddrs':' '.join(urls).split(),'scopes':' '.join(scopes).split(),'authenticated':False}
    return list(results.values())
if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--interface',required=True);ap.add_argument('--timeout',type=float,default=5);args=ap.parse_args()
    try:print(json.dumps({'devices':discover(args.interface,args.timeout),'note':'Discovery only. Authenticate and validate targets before provisioning.'},indent=2))
    except (OSError,ValueError) as exc:ap.exit(1,'Discovery failed: '+str(exc)+'\n')
