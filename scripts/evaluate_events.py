#!/usr/bin/env python3
"""Evaluate adjudicated 1:1 event matches. Input JSON uses observed counts, no synthetic inference."""
import argparse,json,math
from pathlib import Path

def wilson(success,total,z=1.96):
    if total==0:return None
    p=success/total;den=1+z*z/total;center=(p+z*z/(2*total))/den
    half=z*math.sqrt(p*(1-p)/total+z*z/(4*total*total))/den
    return [max(0,center-half),min(1,center+half)]
def evaluate(p):
    keys=['true_positive_events','false_positive_events','false_negative_events','inconclusive_events','duplicate_events','analyzed_camera_hours']
    for k in keys:
        v=p.get(k)
        if isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) or v<0:raise ValueError('Invalid count: '+k)
        if k!='analyzed_camera_hours' and (type(v) is not int):raise ValueError('Event counts must be integers')
    tp,fp,fn=p['true_positive_events'],p['false_positive_events'],p['false_negative_events']
    hours=p['analyzed_camera_hours'];alerts=tp+fp+p['inconclusive_events']
    return {'precision':tp/(tp+fp) if tp+fp else None,'precision_wilson_95':wilson(tp,tp+fp),'recall':tp/(tp+fn) if tp+fn else None,'recall_wilson_95':wilson(tp,tp+fn),'false_alerts_per_camera_hour':fp/hours if hours else None,'inconclusive_rate':p['inconclusive_events']/alerts if alerts else None,'duplicate_count':p['duplicate_events'],'denominators':{'adjudicated_alerts':tp+fp,'ground_truth_events':tp+fn,'analyzed_camera_hours':hours},'note':'Adjudicated event matching must be one-to-one. Inconclusive cases are reported separately, not silently counted as false alerts. No metrics imply guilt or identity.'}
if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('counts',type=Path);args=a.parse_args()
    try:print(json.dumps(evaluate(json.loads(args.counts.read_text())),indent=2))
    except (ValueError,OSError,KeyError) as exc:a.exit(1,str(exc)+'\n')
